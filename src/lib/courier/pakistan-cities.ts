import type { CityZone } from "./types";

export type PakistanCityDef = {
  name: string;
  aliases: string[];
  zone: CityZone;
};

/** Major cities, regional hubs, and common courier destinations across Pakistan. */
export const PAKISTAN_CITIES: PakistanCityDef[] = [
  // ── Metro (provincial / national hubs) ──
  { name: "Karachi", aliases: ["khi", "karachi city", "karcahi"], zone: "metro" },
  { name: "Lahore", aliases: ["lhe", "lahor"], zone: "metro" },
  { name: "Islamabad", aliases: ["isb", "islam abad", "capital"], zone: "metro" },
  { name: "Rawalpindi", aliases: ["rwp", "pindi", "rawal pindi"], zone: "metro" },
  { name: "Faisalabad", aliases: ["fsd", "lyallpur"], zone: "metro" },
  { name: "Multan", aliases: ["mux", "mul tan"], zone: "metro" },
  { name: "Peshawar", aliases: ["pew", "peshawar city"], zone: "metro" },
  { name: "Quetta", aliases: ["uet"], zone: "metro" },
  { name: "Hyderabad", aliases: ["hdd", "hyderabad sindh"], zone: "metro" },
  { name: "Gujranwala", aliases: ["grw"], zone: "metro" },
  { name: "Sialkot", aliases: ["skt"], zone: "metro" },

  // ── Punjab ──
  { name: "Gujrat", aliases: ["gujrat city"], zone: "tier2" },
  { name: "Jhelum", aliases: ["jhelum city"], zone: "tier2" },
  { name: "Sheikhupura", aliases: ["skp", "sheikupura"], zone: "tier2" },
  { name: "Okara", aliases: [], zone: "tier2" },
  { name: "Sahiwal", aliases: [], zone: "tier2" },
  { name: "Kasur", aliases: [], zone: "tier2" },
  { name: "Narowal", aliases: [], zone: "tier2" },
  { name: "Hafizabad", aliases: [], zone: "tier2" },
  { name: "Mandi Bahauddin", aliases: ["mandi baha ud din", "mbd"], zone: "tier2" },
  { name: "Jhang", aliases: [], zone: "tier2" },
  { name: "Khanewal", aliases: [], zone: "tier2" },
  { name: "Dera Ghazi Khan", aliases: ["dg khan", "dgk"], zone: "tier2" },
  { name: "Pakpattan", aliases: [], zone: "tier2" },
  { name: "Attock", aliases: [], zone: "tier2" },
  { name: "Chakwal", aliases: [], zone: "tier2" },
  { name: "Bhakkar", aliases: [], zone: "tier2" },
  { name: "Mianwali", aliases: [], zone: "tier2" },
  { name: "Layyah", aliases: [], zone: "tier2" },
  { name: "Toba Tek Singh", aliases: ["tts"], zone: "tier2" },
  { name: "Gojra", aliases: [], zone: "tier2" },
  { name: "Burewala", aliases: [], zone: "tier2" },
  { name: "Chiniot", aliases: [], zone: "tier2" },
  { name: "Wah Cantonment", aliases: ["wah", "wah cantt"], zone: "tier2" },
  { name: "Taxila", aliases: [], zone: "tier2" },
  { name: "Muridke", aliases: [], zone: "tier2" },
  { name: "Kamoke", aliases: [], zone: "tier2" },
  { name: "Vehari", aliases: [], zone: "tier2" },
  { name: "Bahawalnagar", aliases: [], zone: "tier2" },
  { name: "Rahim Yar Khan", aliases: ["ryk", "rahimyarkhan"], zone: "tier2" },
  { name: "Sargodha", aliases: ["sgd"], zone: "tier2" },
  { name: "Bahawalpur", aliases: ["bwp"], zone: "tier2" },

  // ── Sindh ──
  { name: "Sukkur", aliases: ["skr"], zone: "tier2" },
  { name: "Larkana", aliases: [], zone: "tier2" },
  { name: "Nawabshah", aliases: ["shaheed benazirabad", "benazirabad"], zone: "tier2" },
  { name: "Mirpur Khas", aliases: ["mirpurkhas"], zone: "tier2" },
  { name: "Jacobabad", aliases: [], zone: "tier2" },
  { name: "Khairpur", aliases: [], zone: "tier2" },
  { name: "Dadu", aliases: [], zone: "tier2" },
  { name: "Thatta", aliases: [], zone: "tier2" },
  { name: "Badin", aliases: [], zone: "tier2" },
  { name: "Sanghar", aliases: [], zone: "tier2" },
  { name: "Shikarpur", aliases: [], zone: "tier2" },
  { name: "Umerkot", aliases: [], zone: "tier2" },
  { name: "Ghotki", aliases: [], zone: "tier2" },
  { name: "Naushahro Feroze", aliases: ["naushahro feroze"], zone: "tier2" },

  // ── KPK ──
  { name: "Mardan", aliases: [], zone: "tier2" },
  { name: "Abbottabad", aliases: ["abbotabad"], zone: "tier2" },
  { name: "Kohat", aliases: [], zone: "tier2" },
  { name: "Swabi", aliases: [], zone: "tier2" },
  { name: "Bannu", aliases: [], zone: "tier2" },
  { name: "Mansehra", aliases: [], zone: "tier2" },
  { name: "Haripur", aliases: [], zone: "tier2" },
  { name: "Nowshera", aliases: [], zone: "tier2" },
  { name: "Dera Ismail Khan", aliases: ["d i khan", "dikhan"], zone: "tier2" },
  { name: "Charsadda", aliases: [], zone: "tier2" },
  { name: "Mingora", aliases: ["swat", "swat city"], zone: "tier2" },
  { name: "Timergara", aliases: ["dir"], zone: "tier2" },
  { name: "Hangu", aliases: [], zone: "tier2" },
  { name: "Tank", aliases: [], zone: "tier2" },

  // ── Balochistan ──
  { name: "Turbat", aliases: [], zone: "tier2" },
  { name: "Khuzdar", aliases: [], zone: "tier2" },
  { name: "Hub", aliases: ["hub chowki"], zone: "tier2" },
  { name: "Chaman", aliases: [], zone: "tier2" },
  { name: "Loralai", aliases: [], zone: "tier2" },
  { name: "Sibi", aliases: [], zone: "tier2" },
  { name: "Zhob", aliases: [], zone: "tier2" },

  // ── AJK ──
  { name: "Mirpur", aliases: ["mirpur ajk"], zone: "tier2" },
  { name: "Muzaffarabad", aliases: ["mzd"], zone: "tier2" },
  { name: "Rawalakot", aliases: [], zone: "tier2" },
  { name: "Kotli", aliases: [], zone: "tier2" },

  // ── Remote / northern & hard-to-reach ──
  { name: "Gwadar", aliases: [], zone: "remote" },
  { name: "Gilgit", aliases: ["gilgit baltistan", "gb"], zone: "remote" },
  { name: "Skardu", aliases: ["skardu city"], zone: "remote" },
  { name: "Hunza", aliases: ["hunza valley", "karimabad"], zone: "remote" },
  { name: "Chitral", aliases: [], zone: "remote" },
  { name: "Murree", aliases: [], zone: "remote" },
  { name: "Astore", aliases: [], zone: "remote" },
  { name: "Ghizer", aliases: [], zone: "remote" },
  { name: "Ghanche", aliases: ["khaplu"], zone: "remote" },
  { name: "Nagar", aliases: [], zone: "remote" },
  { name: "Parachinar", aliases: [], zone: "remote" },
  { name: "Kalat", aliases: [], zone: "remote" },
];
