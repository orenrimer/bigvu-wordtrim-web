/**
 * Language Direction Utility
 * Provides functions to detect RTL languages from language codes
 */

// Fallback list of RTL language prefixes (used when Intl.Locale.getTextInfo is not available)
const RTL_LANGUAGE_PREFIXES = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ku', 'dv', 'ha', 'khw', 'ks', 'ku', 'ps', 'ur', 'yi'];

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

