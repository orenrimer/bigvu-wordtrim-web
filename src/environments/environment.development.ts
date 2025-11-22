/**
 * Development environment configuration
 * Contains mock data URLs for local development and testing
 */
export const environment = {
    production: false,

    // Mock segmentation JSON URL
    // Based on PRD: https://assets.bigvu.tv/storyVideos/.../segmentation_en-US.json
    segmentationUrl: 'https://assets.bigvu.tv/storyVideos/690b11f64ae0987678a4b307/takes/690b11f64ae0987678a4b30c/segmentation_en-US.json',

    // Mock video URL (HLS/m3u8 format)
    // Based on PRD: https://assets.bigvu.tv/storyVideos/.../video.m3u8
    videoUrl: 'https://assets.bigvu.tv/storyVideos/690b11f64ae0987678a4b307/takes/690b11f64ae0987678a4b30c/0bc2df15-fca8-491c-8fcc-ad09b37ef40d/4cb84c85-6dc0-47bd-9752-f7d9240b3958-video.m3u8',

    // Tutorial video URL (HLS/m3u8 format)
    tutorialVideoUrl: 'https://assets.bigvu.tv/storyVideos/67309c7576c4e181b919dbdf/takes/67309c7576c4e181b919dbe7/47160a9f-be58-4728-8936-c4fd97946892/video.m3u8',

    // Video data file index (1-20) for loading from assets/data/videos
    videoDataIndex: 21, // Default to video 1, can be changed to 1-20

    // API timeout settings 
    apiTimeout: 30000, // 30 seconds

    // Enable debug logging
    enableDebugLogs: true
};

