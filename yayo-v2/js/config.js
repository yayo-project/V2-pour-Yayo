// ═══════════════════════════════════════════════
// YAYO — Configuration
// Supabase publishable key (safe for client use).
// AI keys live in Netlify Functions, never here.
// ═══════════════════════════════════════════════
const YAYO_CONFIG = {
  SUPABASE_URL: "https://wkjxdkeqffsjarjxlsyh.supabase.co",
  SUPABASE_KEY: "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8",

  // Destinations: shipping (USD) + duty factor (estimation, refined per country)
  DESTINATIONS: {
    kinshasa: { name: "Kinshasa", flag: "🇨🇩", ship: 3200, duty: 0.45, fees: 1070 },
    douala:   { name: "Douala",   flag: "🇨🇲", ship: 2800, duty: 0.50, fees: 1070 },
    abidjan:  { name: "Abidjan",  flag: "🇨🇮", ship: 3500, duty: 0.44, fees: 1070 },
    dakar:    { name: "Dakar",    flag: "🇸🇳", ship: 3300, duty: 0.48, fees: 1070 },
    dubai:    { name: "Dubai",    flag: "🇦🇪", ship: 0,    duty: 0,    fees: 0 }
  },
  DEFAULT_DEST: "kinshasa",
  FEATURED_LIMIT: 6
};
