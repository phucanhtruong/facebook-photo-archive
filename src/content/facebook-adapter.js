(function installFacebookAdapter(global) {
  "use strict";

  const MAX_TEXT_LENGTH = 4_000;
  const COMMENT_BUTTON_TEXT = [
    "view more comments", "see more comments", "load more comments",
    "view previous comments", "view more replies", "see more replies",
    "view previous replies", "more replies", "more comments"
  ];
  const IMAGE_SKIP_WORDS = ["profile", "avatar", "emoji", "sticker", "sprite", "icon"];

  function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function decode(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function parsePhotoPage(url = location.href) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    const host = parsed.hostname.toLowerCase();
    const isFacebook = host === "facebook.com" || host.endsWith(".facebook.com");
    if (!isFacebook) return null;

    const pathname = parsed.pathname.toLowerCase();
    const isPhoto = pathname.includes("/photo") || pathname.includes("/photos") ||
      pathname.includes("/media") || parsed.searchParams.has("fbid");
    if (!isPhoto) return { isFacebook: true, isPhotoPage: false, url: parsed.href };

    const fbid = parsed.searchParams.get("fbid") || parsed.searchParams.get("photo_id") ||
      (pathname.match(/(?:photo|photos|media)[^/]*\/?(\d{8,})/) || [])[1] || null;
    const setId = parsed.searchParams.get("set") || parsed.searchParams.get("type") || null;
    return { isFacebook: true, isPhotoPage: true, url: parsed.href, fbid, setId };
  }

  function extractMetadata(page) {
    const parsed = parsePhotoPage(page.url);
    const title = cleanText(document.querySelector('meta[property="og:title"]')?.content) ||
      cleanText(document.title) || "Facebook photo post";
    const description = cleanText(document.querySelector('meta[property="og:description"]')?.content ||
      document.querySelector('meta[name="description"]')?.content, 8_000);
    const ogImage = document.querySelector('meta[property="og:image"]')?.content || null;
    const textRoot = document.querySelector('[data-pagelet="FeedUnit_0"]') ||
      document.querySelector('div[role="main"]');
    const text = cleanText(textRoot?.innerText || description, 8_000);

    return {
      fbid: parsed?.fbid || null,
      setId: parsed?.setId || null,
      title,
      text,
      description,
      url: parsed?.url || page.url,
      pageTitle: cleanText(document.title) || "Facebook photo post",
      ogImage,
      capturedAt: new Date().toISOString()
    };
  }

  function readSrcSet(value) {
    return String(value || "").split(",").map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const width = descriptor?.endsWith("w") ? Number.parseInt(descriptor, 10) : null;
      return { url, width: Number.isFinite(width) ? width : null };
    }).filter((candidate) => candidate.url);
  }

  function isLargeImage(image, allowOffscreen = false) {
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    const width = rect.width || image.naturalWidth || 0;
    const height = rect.height || image.naturalHeight || 0;
    const largeEnough = width >= 160 && height >= 160;
    const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    return style.display !== "none" && style.visibility !== "hidden" && largeEnough &&
      (allowOffscreen || inViewport);
  }

  function isPageChromeImage(image) {
    return Boolean(image.closest("header, nav, aside, [role='banner'], [role='navigation']"));
  }

  function getPhotoViewerImages() {
    const viewerRoots = [...document.querySelectorAll("[role='dialog'], [aria-modal='true']")];
    const scoped = viewerRoots.flatMap((root) => [...root.querySelectorAll("img")])
      .filter((image) => !isPageChromeImage(image) && isLargeImage(image, true))
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
    if (scoped.length) return scoped;

    // Fallback for Facebook layouts that do not mark the photo viewer as a dialog.
    // Only use large images currently visible in the viewport; never scrape the whole page.
    return [...document.images]
      .filter((image) => !isPageChromeImage(image) && isLargeImage(image))
      .sort((a, b) => {
        const area = (item) => {
          const rect = item.getBoundingClientRect();
          return (rect.width || 0) * (rect.height || 0);
        };
        return area(b) - area(a);
      })
      .slice(0, 12);
  }

  function isUsefulImage(url, width, height) {
    if (!url || /^(data|blob):/i.test(url)) return false;
    if (!/^https?:/i.test(url)) return false;
    const lower = decode(url).toLowerCase();
    if (IMAGE_SKIP_WORDS.some((word) => lower.includes(word))) return false;
    if ((width && width < 160) || (height && height < 160)) return false;
    return true;
  }

  function imageIdentity(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.endsWith("fbcdn.net") || parsed.hostname.endsWith("fbsbx.com")) {
        return `${parsed.hostname}${parsed.pathname}`;
      }
    } catch { /* keep the original URL below */ }
    return url.split("#")[0];
  }

  function extractImages(metadata) {
    const candidates = new Map();
    const add = (url, width = null, height = null, source = "dom") => {
      if (!isUsefulImage(url, width, height)) return;
      const key = imageIdentity(url);
      const existing = candidates.get(key);
      if (!existing || (width || 0) * (height || 0) > (existing.width || 0) * (existing.height || 0)) {
        candidates.set(key, { url: key, width, height, source });
      }
    };

    const viewerImages = getPhotoViewerImages();
    viewerImages.forEach((image) => {
      const width = image.naturalWidth || Number.parseInt(image.getAttribute("width"), 10) || null;
      const height = image.naturalHeight || Number.parseInt(image.getAttribute("height"), 10) || null;
      const selectedUrl = image.currentSrc || image.src || readSrcSet(image.getAttribute("srcset"))
        .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
      add(selectedUrl, width, height, "photo-viewer");
    });
    // og:image can be stale or already expired. Use it only when no live viewer
    // image was found, never alongside a live viewer candidate.
    if (!viewerImages.length) add(metadata.ogImage, null, null, "og:image");

    return [...candidates.values()].sort((a, b) =>
      ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  }

  function findCommentArticle(element) {
    return element.closest('div[role="article"]') || element.closest('li') || element.parentElement;
  }

  function extractComments() {
    const results = [];
    const seen = new Set();
    const roots = [...document.querySelectorAll('div[role="article"]')];
    roots.forEach((root) => {
      const text = cleanText(root.innerText, MAX_TEXT_LENGTH);
      if (!text || text.length < 2 || text.length > MAX_TEXT_LENGTH) return;
      const links = [...root.querySelectorAll('a[href]')];
      const authorLink = links.find((link) => cleanText(link.textContent, 200));
      const author = cleanText(authorLink?.textContent, 200) || null;
      const permalink = links.find((link) => /comment|reply/i.test(link.href))?.href || null;
      const key = `${author || ""}|${text}|${permalink || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ author, text, parent: null, depth: 0, permalink });
    });

    // A bounded fallback catches comment containers that Facebook renders without role=article.
    if (!results.length) {
      document.querySelectorAll('[data-testid*="comment"], [data-testid*="reply"]').forEach((node) => {
        const text = cleanText(node.innerText, MAX_TEXT_LENGTH);
        if (text && !seen.has(text)) {
          seen.add(text);
          results.push({ author: null, text, parent: null, depth: 0, permalink: null });
        }
      });
    }
    return results;
  }

  function buttonLabel(element) {
    return cleanText(element.getAttribute("aria-label") || element.textContent, 300).toLowerCase();
  }

  async function expandComments(limits, onProgress) {
    const started = Date.now();
    let actions = 0;
    let lastCount = 0;
    while (actions < limits.maxExpansionActions && Date.now() - started < limits.maxExpansionMs) {
      const buttons = [...document.querySelectorAll('button, [role="button"]')];
      const target = buttons.find((button) => {
        const label = buttonLabel(button);
        return COMMENT_BUTTON_TEXT.some((needle) => label.includes(needle)) && !button.disabled;
      });
      if (!target) break;
      target.scrollIntoView({ block: "center", behavior: "instant" });
      target.click();
      actions += 1;
      await new Promise((resolve) => setTimeout(resolve, 700));
      const count = document.querySelectorAll('div[role="article"]').length;
      if (count !== lastCount) {
        lastCount = count;
        onProgress?.(`Expanded comments (${actions}/${limits.maxExpansionActions})`);
      }
    }
    return { actions, elapsedMs: Date.now() - started };
  }

  async function run(request, limits, onProgress) {
    const page = parsePhotoPage(request.url || location.href);
    if (!page?.isFacebook) throw new Error("The current tab is not a Facebook page.");
    if (!page.isPhotoPage) throw new Error("Open a Facebook photo post before downloading.");
    onProgress?.("Reading photo metadata...");
    const metadata = extractMetadata(page);
    onProgress?.("Expanding visible comments and replies...");
    const expansion = await expandComments(limits, onProgress);
    const allComments = extractComments();
    const comments = allComments.slice(0, limits.maxComments);
    onProgress?.("Finding image candidates...");
    const images = extractImages(metadata).slice(0, limits.maxImages).map((item, index) => ({
      ...item,
      index: index + 1
    }));
    return {
      metadata,
      comments,
      images,
      stats: {
        commentCount: comments.length,
        imageCount: images.length,
        expansionActions: expansion.actions,
        expansionElapsedMs: expansion.elapsedMs,
        truncatedComments: allComments.length > comments.length
      }
    };
  }

  global.FacebookPhotoArchiveAdapter = { parsePhotoPage, extractMetadata, extractComments, extractImages, expandComments, run };
})(globalThis);
