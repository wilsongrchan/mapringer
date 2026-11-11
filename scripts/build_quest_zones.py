"""Build the data behind sea quests and quest feasibility.

1. public/hints/seas.png: which named sea each patch of water belongs to, on a
   5 arc-minute grid (4320 x 2160, grey value = index into `seaNames`, 0 =
   none), from Natural Earth's marine areas. Gaps along coasts are filled
   from the nearest named water (up to ~25 km), so a coastal sea cell of the
   land mask always finds its sea. The game reads it for "touch the …" quests.

2. src/quest-zones.json: the sea quests (name, the marine areas they count,
   a view to fly to) and, for every quest that's judged by place, the
   densest crowd a ring of each size can hold while doing it ("caps", people
   per km², 75% of the measured best). questFor only offers a quest when the
   ring's target fits under its cap, so every quest is possible.

Sources: Natural Earth ne_10m_geography_marine_polys (public domain),
public/data/land.tif, public/data/population_10x.tif.

Usage:
    .venv/bin/python scripts/build_quest_zones.py <ne_10m_geography_marine_polys.shp> public/data
"""

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
import shapefile  # pyshp
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import distance_transform_edt
from scipy.signal import oaconvolve

RES = 1 / 12  # 5 arc-minutes
W, H = 360 * 12, 180 * 12
TRANSFORM = from_origin(-180, 90, RES, RES)
KM_PER_DEG = 111.195
RADII = [3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 100, 200, 300]  # (the giant twists have fixed quests)
CAP_SHARE = 0.75
TROPIC = 23.436

# Sea quests: id, English, Chinese, and the Natural Earth marine areas that count.
SEAS = [
    ("pacific", "the Pacific Ocean", "太平洋", ["North Pacific Ocean", "South Pacific Ocean", "Philippine Sea", "Coral Sea", "Tasman Sea", "Gulf of Alaska", "Golfo de California", "Golfo de Panamá", "Golfo de Guayaquil", "Golfo de Tehuantepec", "Bay of Plenty", "Salish Sea", "San Francisco Bay", "Monterey Bay", "Cook Inlet", "Prince William Sound", "Uchiura Bay", "Bismarck Sea", "Solomon Sea", "Hecate Strait", "Queen Charlotte Sound", "Dixon Entrance", "Cook Strait"]),
    ("atlantic", "the Atlantic Ocean", "大西洋", ["North Atlantic Ocean", "South Atlantic Ocean", "Sargasso Sea", "Bay of Biscay", "Gulf of Guinea", "Bight of Benin", "Bight of Biafra", "Gulf of Maine", "Massachusetts Bay", "Delaware Bay", "Chesapeake Bay", "Long Island Sound", "Río de la Plata", "Labrador Sea", "Bay of Fundy", "Golfo San Matías", "Golfo San Jorge", "Bahía Blanca", "St. Helena Bay", "Pamlico Sound", "Albemarle Sound"]),
    ("indian", "the Indian Ocean", "印度洋", ["INDIAN OCEAN", "Arabian Sea", "Bay of Bengal", "Laccadive Sea", "Andaman Sea", "Mozambique Channel", "Great Australian Bight", "Timor Sea", "Gulf of Aden", "Gulf of Masira", "Gulf of Mannar", "Shark Bay", "Geographe Bay", "Gulf St. Vincent", "Gulf of Khambhät", "Gulf of Kutch", "Gulf of Martaban", "Antongila Bay", "Baia de Maputo"]),
    ("mediterranean", "the Mediterranean Sea", "地中海", ["Mediterranean Sea", "Adriatic Sea", "Aegean Sea", "Ionian Sea", "Tyrrhenian Sea", "Ligurian Sea", "Balearic Sea", "Alboran Sea", "Sea of Crete", "Gulf of Sidra", "Gulf of Gabès", "Golfe du Lion"]),
    ("persianGulf", "the Persian Gulf", "波斯灣", ["Persian Gulf"]),
    ("redSea", "the Red Sea", "紅海", ["Red Sea", "Gulf of Aqaba", "Gulf of Suez"]),
    ("blackSea", "the Black Sea", "黑海", ["Black Sea"]),
    ("caspian", "the Caspian Sea", "裏海", ["Caspian Sea"]),
    ("baltic", "the Baltic Sea", "波羅的海", ["Baltic Sea", "Gulf of Finland", "Gulf of Bothnia", "Gulf of Riga", "Mecklenburger Bucht"]),
    ("northSea", "the North Sea", "北海", ["North Sea", "Waddenzee", "Skagerrak"]),
    ("englishChannel", "the English Channel", "英吉利海峽", ["English Channel"]),
    ("caribbean", "the Caribbean Sea", "加勒比海", ["Caribbean Sea", "Gulf of Honduras", "Golfo de Urabá"]),
    ("gulfOfMexico", "the Gulf of Mexico", "墨西哥灣", ["Gulf of Mexico", "Bahía de Campeche"]),
    ("southChinaSea", "the South China Sea", "南中國海", ["South China Sea", "Gulf of Tonkin"]),
    ("eastChinaSea", "the East China Sea", "東海", ["East China Sea", "Hangzhou Bay", "Taiwan Strait"]),
    ("yellowSea", "the Yellow Sea", "黃海", ["Yellow Sea", "Bo Hai"]),
    ("seaOfJapan", "the Sea of Japan", "日本海", ["Sea of Japan"]),
    ("bayOfBengal", "the Bay of Bengal", "孟加拉灣", ["Bay of Bengal"]),
    ("arabianSea", "the Arabian Sea", "阿拉伯海", ["Arabian Sea", "Gulf of Khambhät", "Gulf of Kutch"]),
]


def load_marine(shp_path):
    r = shapefile.Reader(shp_path)
    wanted = sorted({n for _, _, _, names in SEAS for n in names})
    index = {n: i + 1 for i, n in enumerate(wanted)}
    shapes = []
    for sr in r.iterShapeRecords():
        name = sr.record["name"]
        if name in index and sr.shape.points:
            # pyshp: one record can hold several outer rings; rasterize each part on its own
            pts, parts = sr.shape.points, list(sr.shape.parts) + [len(sr.shape.points)]
            for i in range(len(parts) - 1):
                ring = pts[parts[i]:parts[i + 1]]
                if len(ring) >= 4:
                    shapes.append(({"type": "Polygon", "coordinates": [ring]}, index[name]))
    # big areas first, so smaller seas drawn later win where they overlap
    shapes.sort(key=lambda s: -abs(np.ptp([p[0] for p in s[0]["coordinates"][0]]) * np.ptp([p[1] for p in s[0]["coordinates"][0]])))
    labels = rasterize(shapes, out_shape=(H, W), transform=TRANSFORM, fill=0, dtype="uint8")
    return wanted, labels


def main(shp_path, data_dir):
    data = Path(data_dir)
    names, labels = load_marine(shp_path)
    print("sea names:", len(names))

    # land mask at 5': majority of the 25 one-minute cells
    with rasterio.open(data / "land.tif") as f:
        land1 = f.read(1)
    blocks = land1.reshape(H, 5, W, 5)
    land_frac = (blocks > 0).mean(axis=(1, 3))
    sea = land_frac < 0.5
    island = ((blocks > 0) & ((blocks & 8) > 0)).mean(axis=(1, 3)) > 0
    mainland = ((blocks > 0) & ((blocks & 8) == 0)).mean(axis=(1, 3)) > 0
    cont_code = np.zeros((H, W), np.uint8)
    for code in range(1, 8):
        frac = ((blocks & 7) == code).mean(axis=(1, 3))
        cont_code[frac > 0.3] = code
    del blocks, land1

    # country at each 5' cell (its middle 1' cell), for "centre your ring in …"
    with rasterio.open(data / "countries.tif") as f:
        cmask = f.read(1)
        ck = int(round(RES / f.transform.a))
    country = cmask[ck // 2::ck, ck // 2::ck][:H, :W]
    countries = json.loads(Path("src/countries.json").read_text())
    # the cities of "keep your ring's centre within 200 km of …"
    cities = []
    for line in Path("src/cities.ts").read_text().splitlines():
        if line.strip().startswith('{ id: "'):
            cid = line.split('id: "')[1].split('"')[0]
            lat = float(line.split("lat: ")[1].split(",")[0])
            lng = float(line.split("lng: ")[1].split(",")[0].split(" ")[0])
            cities.append((cid, lat, lng))

    # fill unnamed sea cells from the nearest named water, up to 3 cells away
    dist, (ri, ci) = distance_transform_edt(labels == 0, return_indices=True)
    fill = (labels == 0) & (dist <= 3)
    labels[fill] = labels[ri[fill], ci[fill]]

    # population at 5', aligned to this grid
    with rasterio.open(data / "population_10x.tif") as f:
        p = f.read(1).astype(np.float64)
        pt = f.transform
    p[~np.isfinite(p)] = 0
    p[p < 0] = 0
    pop = np.zeros((H, W))
    r0 = int(round((90 - pt.f) / RES))
    c0 = int(round((pt.c + 180) / RES))
    rows = min(p.shape[0], H - r0)
    cols = min(p.shape[1], W - c0)
    pop[r0:r0 + rows, c0:c0 + cols] = p[:rows, :cols]
    print("population", pop.sum() / 1e9, "bn")

    lats = 90 - (np.arange(H) + 0.5) * RES
    lngs = -180 + (np.arange(W) + 0.5) * RES
    LAT = lats[:, None]

    def disk_sum(arr, r_km):
        """Sum of `arr` within r_km of each cell (lat-aware ellipse kernels, wrapping in longitude)."""
        out = np.zeros_like(arr, dtype=np.float64)
        band = 24  # rows per band (2°)
        hy = int(np.ceil(r_km / (KM_PER_DEG * RES)))
        for b0 in range(0, H, band):
            b1 = min(H, b0 + band)
            lat = abs(lats[(b0 + b1) // 2])
            coslat = max(np.cos(np.radians(min(lat, 89))), 0.02)
            hx = min(W // 2 - 1, int(np.ceil(r_km / (KM_PER_DEG * RES * coslat))))
            yy, xx = np.mgrid[-hy:hy + 1, -hx:hx + 1]
            kern = ((yy * KM_PER_DEG * RES) ** 2 + (xx * KM_PER_DEG * RES * coslat) ** 2 <= r_km ** 2).astype(np.float64)
            top, bot = max(0, b0 - hy), min(H, b1 + hy)
            chunk = np.pad(arr[top:bot].astype(np.float64), ((0, 0), (hx, hx)), mode="wrap")
            conv = oaconvolve(chunk, kern, mode="same")
            out[b0:b1] = conv[b0 - top:b1 - top, hx:hx + W]
        return out

    zones = {}
    sea_groups = {sid: np.isin(labels, [names.index(n) + 1 for n in members]) & sea for sid, _, _, members in SEAS}
    caps = {}
    for r in RADII:
        ring_pop = disk_sum(pop, r)
        density = ring_pop / (np.pi * r * r)
        latR = r / KM_PER_DEG
        widest = np.minimum(89.9, np.abs(LAT) + latR)
        lngR = r / (KM_PER_DEG * np.cos(np.radians(widest)))
        LNG = lngs[None, :]
        touch_sea = disk_sum(sea.astype(np.float64), r) > 0.5
        z = {
            "landlocked": ~touch_sea,
            "islandsOnly": (disk_sum(mainland.astype(np.float64), r) < 0.5) & (disk_sum(island.astype(np.float64), r) > 0.5),
            "centreAtSea": sea.copy(),
            "northOfCancer": np.broadcast_to(LAT - latR > TROPIC, (H, W)),
            "southOfCapricorn": np.broadcast_to(LAT + latR < -TROPIC, (H, W)),
            "tropics": np.broadcast_to((LAT - latR > -TROPIC) & (LAT + latR < TROPIC), (H, W)),
            "equator": np.broadcast_to((LAT - latR < 0) & (LAT + latR > 0), (H, W)),
            "west": (LNG - lngR >= -180) & (LNG + lngR <= 0),
            "east": (LNG - lngR >= 0) & (LNG + lngR <= 180),
            "primeMeridian": np.abs(LNG) < r / (KM_PER_DEG * np.cos(np.radians(np.minimum(89.9, np.abs(LAT))))),
        }
        for lat in (45, 50, 55):
            z[f"northOf{lat}"] = np.broadcast_to(LAT - latR > lat, (H, W))
        for lat in (30, 35):
            z[f"southOf{lat}"] = np.broadcast_to(LAT + latR < -lat, (H, W))
        touched = np.zeros((H, W), np.uint8)
        for code, name in {1: "africa", 2: "asia", 3: "europe", 4: "northAmerica", 5: "southAmerica", 6: "oceania"}.items():
            z[f"continent:{name}"] = cont_code == code
            touched += disk_sum((cont_code == code).astype(np.float64), r) > 0.5
        z["twoContinents"] = touched >= 2
        for sid, mask in sea_groups.items():
            z[f"sea:{sid}"] = disk_sum(mask.astype(np.float64), r) > 0.5
        for i, c in enumerate(countries):
            z[f"country:{c['id']}"] = country == i + 1
        for cid, clat, clng in cities:
            a, b = np.radians(clat), np.radians(clng)
            la, lo = np.radians(LAT), np.radians(LNG)
            d = 6371 * 2 * np.arcsin(np.sqrt(np.clip(np.sin((la - a) / 2) ** 2 + np.cos(a) * np.cos(la) * np.sin((lo - b) / 2) ** 2, 0, 1)))
            z[f"nearCity:{cid}"] = d <= 200
        for zid, mask in z.items():
            best = float(density[mask].max()) if mask.any() else 0.0
            caps.setdefault(zid, {})[str(r)] = round(best * CAP_SHARE, 2)
        print("radius", r, "done", flush=True)

    seas_out = []
    for sid, en, zh, members in SEAS:
        m = sea_groups[sid]
        rr, cc = np.nonzero(m)
        # a view of the sea: its cells' extent (seas crossing 180° use the Pacific-centred extent)
        lng_c, lat_c = lngs[cc], lats[rr]
        if lng_c.max() - lng_c.min() > 300:
            lng_c = np.where(lng_c < 0, lng_c + 360, lng_c)
        view = [round(float(np.percentile(lng_c, 2)), 1), round(float(np.percentile(lat_c, 2)), 1), round(float(np.percentile(lng_c, 98)), 1), round(float(np.percentile(lat_c, 98)), 1)]
        seas_out.append({"id": sid, "en": en, "zh": zh, "labels": [names.index(n) + 1 for n in members], "view": view})

    out = {"_note": "Built by scripts/build_quest_zones.py. caps: densest crowd (people/km², 75% of the measured best) a ring of each radius can hold while doing each quest.", "seaNames": names, "seas": seas_out, "caps": caps}
    Path("src/quest-zones.json").write_text(json.dumps(out, separators=(",", ":")))
    Image.fromarray(labels).save("public/hints/seas.png", optimize=True)
    print("wrote src/quest-zones.json and public/hints/seas.png")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
