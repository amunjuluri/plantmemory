"""Translate an approved-to-be guide into the workers' languages, and check the result.

Code checks what a reviewer reading only English cannot: every number, part number,
alarm code and machine tag in an English line must appear unchanged in its translation.
Lines that fail are flagged for QA rather than silently printed.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

from app.agent import prompts
from app.agent.tools import AgentDeps
from app.models import Guide, GuideTranslation, TranslationOut

LANGUAGE_NAMES = {
    "as": "Assamese",
    "bn": "Bengali",
    "en": "English",
    "gu": "Gujarati",
    "hi": "Hindi",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "or": "Odia",
    "pa": "Punjabi",
    "ta": "Tamil",
    "te": "Telugu",
    "ur": "Urdu",
}
HEDGE_S = 15.0  # a translation normally takes 8 to 12 s
_LISTS = ("safety", "steps", "step_cautions", "restart_checks", "escalate_if")
_ITEM_LABEL = {
    "safety": "Safety point",
    "steps": "Step",
    "step_cautions": "Caution on step",
    "restart_checks": "Restart check",
    "escalate_if": "Call for help",
}
# Indian-script digits (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu,
# Kannada, Malayalam) mapped to 0-9, so "౧౨౧" counts as "121".
_DIGITS = {
    chr(base + i): str(i)
    for base in (0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66)
    for i in range(10)
}
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
_TOKEN = re.compile(r"\b[A-Z]{1,5}(?:-[A-Z0-9]+)+\b|\b[A-Z]{1,3}\d{1,4}\b")


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def source_lists(guide: Guide) -> dict:
    """The English text to translate, list by list."""
    return {
        "title": guide.title,
        "summary": guide.summary,
        "safety": [i.text for i in guide.safety],
        "steps": [s.text for s in guide.steps],
        "step_cautions": [s.caution or "" for s in guide.steps],
        "restart_checks": [i.text for i in guide.restart_checks],
        "escalate_if": list(guide.escalate_if),
    }


def _ascii_digits(text: str) -> str:
    return "".join(_DIGITS.get(ch, ch) for ch in text)


def missing_tokens(english: str, translated: str) -> list[str]:
    """Numbers and codes in the English line that are not in the translation."""
    target = _ascii_digits(translated)
    numbers = {n.replace(",", ".") for n in _NUMBER.findall(target)}
    missing = [t for t in dict.fromkeys(_TOKEN.findall(english)) if t not in target]
    # Numbers inside codes (the 07 in RTP-BS-07) are checked with their code above.
    for number in dict.fromkeys(_NUMBER.findall(_TOKEN.sub(" ", english))):
        if number.replace(",", ".") not in numbers:
            missing.append(number)
    return missing


def check_translation(source: dict, out: TranslationOut) -> list[str]:
    """Plain-language flags for QA: missing items, numbers or codes."""
    flags = []
    for key in _LISTS:
        english, translated = source[key], getattr(out, key)
        for i, line in enumerate(english):
            if not line:
                continue
            label = f"{_ITEM_LABEL[key]} {i + 1}"
            if i >= len(translated) or not translated[i].strip():
                flags.append(f"{label}: translation missing.")
                continue
            lost = missing_tokens(line, translated[i])
            if lost:
                flags.append(f"{label}: {', '.join(lost)} not found in the translation.")
    for key in ("title", "summary"):
        lost = missing_tokens(source[key], getattr(out, key))
        if lost:
            flags.append(f"{key.capitalize()}: {', '.join(lost)} not found in the translation.")
    return flags


def _wrong_lengths(source: dict, out: TranslationOut) -> list[str]:
    return [k for k in _LISTS if len(getattr(out, k)) != len(source[k])]


def _fit(items: list[str], n: int) -> list[str]:
    return (items + [""] * n)[:n]


def translate_one(guide: Guide, language: str, deps: AgentDeps) -> GuideTranslation:
    """Translate into one language; one retry if the lists come back the wrong length."""
    name = language_name(language)
    source = source_lists(guide)
    prompt = prompts.TRANSLATE_PROMPT.format(
        language_name=name, source=json.dumps(source, ensure_ascii=False, indent=1)
    )
    out = deps.llm.generate(prompt, TranslationOut, thinking="low", hedge_after_s=HEDGE_S)
    wrong = _wrong_lengths(source, out)
    if wrong:
        retry = prompt + prompts.TRANSLATE_RETRY.format(lists=", ".join(wrong))
        out = deps.llm.generate(retry, TranslationOut, thinking="low", hedge_after_s=HEDGE_S)
    flags = check_translation(source, out)
    return GuideTranslation(
        language=language,
        language_name=name,
        title=out.title,
        summary=out.summary,
        **{key: _fit(getattr(out, key), len(source[key])) for key in _LISTS},
        flags=flags,
    )


def translate_guide(guide: Guide, languages: list[str], deps: AgentDeps) -> list[GuideTranslation]:
    """Translate into every language in parallel."""
    wanted = [lang for lang in dict.fromkeys(languages) if lang != "en"]
    if not wanted:
        return []
    with ThreadPoolExecutor(max_workers=len(wanted)) as pool:
        return list(pool.map(lambda lang: translate_one(guide, lang, deps), wanted))
