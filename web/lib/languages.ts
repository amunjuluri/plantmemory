/** Each language a guide can be printed in, by its name in its own script: shown when
 * choosing languages, so a supervisor can check with the crew. */
export const NATIVE_NAME: Record<string, string> = {
  te: "తెలుగు",
  hi: "हिन्दी",
  ta: "தமிழ்",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  mr: "मराठी",
  bn: "বাংলা",
  as: "অসমীয়া",
  gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ",
  or: "ଓଡ଼ିଆ",
  ur: "اردو",
};

/** Urdu is written right to left. */
export const dir = (language: string) => (language === "ur" ? "rtl" : undefined);
