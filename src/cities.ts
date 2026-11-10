/**
 * Cities for "keep your ring's centre within N km of …" quests. `dense` marks
 * the megacities where even a tiny, packed ring (3–5 km, millions of people)
 * is possible, so those twists only ever ask for one of them.
 */
export interface City {
  id: string;
  en: string;
  zh: string;
  lat: number;
  lng: number;
  dense?: boolean;
}

export const CITIES: City[] = [
  { id: "paris", en: "Paris", zh: "巴黎", lat: 48.857, lng: 2.352 },
  { id: "london", en: "London", zh: "倫敦", lat: 51.507, lng: -0.128 },
  { id: "rome", en: "Rome", zh: "羅馬", lat: 41.903, lng: 12.496 },
  { id: "berlin", en: "Berlin", zh: "柏林", lat: 52.52, lng: 13.405 },
  { id: "madrid", en: "Madrid", zh: "馬德里", lat: 40.417, lng: -3.704 },
  { id: "istanbul", en: "Istanbul", zh: "伊斯坦堡", lat: 41.008, lng: 28.978 },
  { id: "moscow", en: "Moscow", zh: "莫斯科", lat: 55.756, lng: 37.617 },
  { id: "cairo", en: "Cairo", zh: "開羅", lat: 30.044, lng: 31.236, dense: true },
  { id: "lagos", en: "Lagos", zh: "拉各斯", lat: 6.524, lng: 3.379 },
  { id: "nairobi", en: "Nairobi", zh: "內羅畢", lat: -1.292, lng: 36.822 },
  { id: "johannesburg", en: "Johannesburg", zh: "約翰內斯堡", lat: -26.204, lng: 28.047 },
  { id: "dubai", en: "Dubai", zh: "杜拜", lat: 25.205, lng: 55.271 },
  { id: "tehran", en: "Tehran", zh: "德黑蘭", lat: 35.689, lng: 51.389 },
  { id: "karachi", en: "Karachi", zh: "卡拉奇", lat: 24.861, lng: 67.01, dense: true },
  { id: "delhi", en: "Delhi", zh: "德里", lat: 28.614, lng: 77.209, dense: true },
  { id: "mumbai", en: "Mumbai", zh: "孟買", lat: 19.076, lng: 72.878, dense: true },
  { id: "kolkata", en: "Kolkata", zh: "加爾各答", lat: 22.573, lng: 88.364, dense: true },
  { id: "dhaka", en: "Dhaka", zh: "達卡", lat: 23.81, lng: 90.412, dense: true },
  { id: "bangkok", en: "Bangkok", zh: "曼谷", lat: 13.756, lng: 100.502 },
  { id: "singapore", en: "Singapore", zh: "新加坡", lat: 1.352, lng: 103.82 },
  { id: "jakarta", en: "Jakarta", zh: "雅加達", lat: -6.208, lng: 106.846, dense: true },
  { id: "manila", en: "Manila", zh: "馬尼拉", lat: 14.6, lng: 120.984, dense: true },
  { id: "hongkong", en: "Hong Kong", zh: "香港", lat: 22.32, lng: 114.17, dense: true },
  { id: "shanghai", en: "Shanghai", zh: "上海", lat: 31.23, lng: 121.474 },
  { id: "beijing", en: "Beijing", zh: "北京", lat: 39.904, lng: 116.407 },
  { id: "seoul", en: "Seoul", zh: "首爾", lat: 37.567, lng: 126.978 },
  { id: "tokyo", en: "Tokyo", zh: "東京", lat: 35.676, lng: 139.65 },
  { id: "sydney", en: "Sydney", zh: "悉尼", lat: -33.869, lng: 151.209 },
  { id: "newyork", en: "New York", zh: "紐約", lat: 40.713, lng: -74.006 },
  { id: "losangeles", en: "Los Angeles", zh: "洛杉磯", lat: 34.052, lng: -118.244 },
  { id: "chicago", en: "Chicago", zh: "芝加哥", lat: 41.878, lng: -87.63 },
  { id: "mexicocity", en: "Mexico City", zh: "墨西哥城", lat: 19.433, lng: -99.133 },
  { id: "bogota", en: "Bogotá", zh: "波哥大", lat: 4.711, lng: -74.072 },
  { id: "lima", en: "Lima", zh: "利馬", lat: -12.046, lng: -77.043 },
  { id: "saopaulo", en: "São Paulo", zh: "聖保羅", lat: -23.551, lng: -46.633 },
  { id: "buenosaires", en: "Buenos Aires", zh: "布宜諾斯艾利斯", lat: -34.604, lng: -58.382 },
];
