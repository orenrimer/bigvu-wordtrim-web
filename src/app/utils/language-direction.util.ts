/**
 * Language Direction Utility
 * Provides functions to detect RTL languages from language codes and text content
 */

// Fallback list of RTL language prefixes (used when Intl.Locale.getTextInfo is not available)
const RTL_LANGUAGE_PREFIXES = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ku', 'dv', 'ha', 'khw', 'ks', 'ku', 'ps', 'ur', 'yi'];

// Comprehensive RTL character ranges
// Covers: Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, and Arabic presentation forms
const RTL_CHAR_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u0800-\u083F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Get text direction for a given language code
 * Uses Intl.Locale API when available, falls back to a known RTL list
 * @param langCode Language code (e.g., 'he-IL', 'ar-SA', 'en-US')
 * @returns 'rtl' or 'ltr'
 */
export function getTextDirection(langCode: string): 'ltr' | 'rtl' {
    if (!langCode) return 'ltr';

    // Try native Intl.Locale API first (Chrome 99+, Safari 15.4+)
    try {
        const locale = new Intl.Locale(langCode);
        // getTextInfo() returns { direction: 'ltr' | 'rtl' }
        if (typeof (locale as any).getTextInfo === 'function') {
            const textInfo = (locale as any).getTextInfo();
            if (textInfo?.direction) {
                return textInfo.direction;
            }
        }
    } catch {
        // Intl.Locale not supported or invalid language code
    }

    // Fallback: check language code prefix against known RTL languages
    const prefix = langCode.split('-')[0].toLowerCase();
    return RTL_LANGUAGE_PREFIXES.includes(prefix) ? 'rtl' : 'ltr';
}

/**
 * Check if a language code represents an RTL language
 * @param langCode Language code (e.g., 'he-IL', 'ar-SA', 'en-US')
 * @returns true if RTL, false otherwise
 */
export function isRTLLanguage(langCode: string): boolean {
    return getTextDirection(langCode) === 'rtl';
}

/**
 * Extract language code from a segmentation URL
 * Matches patterns like: segmentation_he-IL.json, segmentation_ar-SA.json
 * @param url Segmentation URL
 * @returns Language code (e.g., 'he-IL') or null if not found
 */
export function extractLanguageFromSegmentationUrl(url: string): string | null {
    if (!url) return null;

    // Match pattern: segmentation_xx-XX.json (e.g., segmentation_he-IL.json)
    const match = url.match(/segmentation_([a-z]{2}-[A-Z]{2})\.json/i);
    return match ? match[1] : null;
}

/**
 * Detect if a segmentation URL is for RTL content
 * @param url Segmentation URL
 * @returns true if RTL language detected, false otherwise
 */
export function isRTLFromSegmentationUrl(url: string): boolean {
    const langCode = extractLanguageFromSegmentationUrl(url);
    return langCode ? isRTLLanguage(langCode) : false;
}

/**
 * Check if a text string contains RTL characters
 * @param text Text to check
 * @returns true if text contains RTL characters, false otherwise
 */
export function containsRTLCharacters(text: string): boolean {
    if (!text) return false;
    return RTL_CHAR_REGEX.test(text);
}

/**
 * Detect if an array of words contains RTL text
 * Samples the first N words to determine the direction
 * @param words Array of word strings to check
 * @param sampleSize Number of words to sample (default: 5)
 * @returns true if RTL text detected, false otherwise
 */
export function isRTLFromWords(words: string[], sampleSize: number = 5): boolean {
    if (!words || words.length === 0) return false;

    const samplesToCheck = Math.min(sampleSize, words.length);
    for (let i = 0; i < samplesToCheck; i++) {
        if (containsRTLCharacters(words[i])) {
            return true;
        }
    }
    return false;
}

