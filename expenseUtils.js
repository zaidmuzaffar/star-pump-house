// Shop expenses (collection "expenses"): { date, timestamp, kind, amount, method, note }
// Used by the Expenses page, Profit Report (net profit), Cash Closing (cash ones leave the galla) and the assistant.
export const KINDS = [
  ["rent", "Rent", "#0E6A8C"], ["electricity", "Electricity / bills", "#C2771F"], ["salary", "Salary / wages", "#2F8F5B"],
  ["food", "Tea / food", "#8E5BB5"], ["transport", "Transport / fuel", "#B3362E"], ["repair", "Repairs", "#5D6B78"],
  ["other", "Other", "#8A949D"]
];
export const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || KINDS[KINDS.length - 1])[1];
export const kindColor = (k) => (KINDS.find((x) => x[0] === k) || KINDS[KINDS.length - 1])[2];
export const isCash = (e) => !e.method || e.method === "Cash";
// guess the kind from words (assistant / typing)
export function kindOf(text) {
  const t = String(text || "").toLowerCase();
  if (/rent|kiraya|kiraa/.test(t)) return "rent";
  if (/bijli|electric|bill|gas|pani|water|internet|mobile/.test(t)) return "electricity";
  if (/salary|tankhwah|tankhah|wage|mazdoor|labou?r|helper|staff/.test(t)) return "salary";
  if (/chai|tea|khana|food|lunch|nashta/.test(t)) return "food";
  if (/transport|rickshaw|petrol|fuel|kiraya gari|delivery|loading|bhara|bhaara/.test(t)) return "transport";
  if (/repair|marammat|theek|fix/.test(t)) return "repair";
  return "other";
}
