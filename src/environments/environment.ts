/**
 * Production environment configuration
 * These URLs should be updated when integrating with actual BIGVU infrastructure
 */
export const environment = {
    production: true,

    // Production segmentation JSON URL
    // TODO: Update with actual production URL when integrating with BIGVU
    segmentationUrl: 'https://assets.bigvu.tv/storyVideos/690b11f64ae0987678a4b307/takes/690b11f64ae0987678a4b30c/segmentation_en-US.json',

    // Production video URL (HLS/m3u8 format)
    // TODO: Update with actual production URL when integrating with BIGVU
    videoUrl: 'https://assets.bigvu.tv/storyVideos/690b11f64ae0987678a4b307/takes/690b11f64ae0987678a4b30c/0bc2df15-fca8-491c-8fcc-ad09b37ef40d/4cb84c85-6dc0-47bd-9752-f7d9240b3958-video.m3u8',

    // Tutorial video URL (HLS/m3u8 format)
    tutorialVideoUrl: 'https://assets.bigvu.tv/storyVideos/67309c7576c4e181b919dbdf/takes/67309c7576c4e181b919dbe7/47160a9f-be58-4728-8936-c4fd97946892/video.m3u8',

    // API timeout settings
    apiTimeout: 30000, // 30 seconds

    // Disable debug logging in production
    enableDebugLogs: false
};

