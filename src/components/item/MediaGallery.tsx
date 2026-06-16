"use client";
import { Dispatch, SetStateAction } from "react";

// Hero media column for the item detail page: the main image with a hover
// carousel + a thumbnail strip. `idx` is owned by the page (reset on item change).
export default function MediaGallery({
  images, idx, setIdx, title,
}: {
  images: string[];
  idx: number;
  setIdx: Dispatch<SetStateAction<number>>;
  title: string;
}) {
  return (
    <div className="flex-shrink-0">
      {images.length > 0 ? (
        <div className="relative group rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800">
          <img
            src={images[idx]}
            alt={title}
            className="w-full object-cover"
            style={{ maxHeight: 460 }}
            onError={() => { if (idx < images.length - 1) setIdx(idx + 1); }}
          />
          {images.length > 1 && (
            <>
              <button
                onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              ><span aria-hidden>←</span></button>
              <button
                onClick={() => setIdx((i) => (i + 1) % images.length)}
                aria-label="Next image"
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              ><span aria-hidden>→</span></button>
            </>
          )}
        </div>
      ) : (
        <div className="w-full rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center" style={{ height: 320 }}>
          <span className="text-neutral-700 text-sm">No image</span>
        </div>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {images.map((src, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === idx}
              className="w-16 h-10 rounded-lg overflow-hidden border transition-colors flex-shrink-0"
              style={{ borderColor: i === idx ? "#fff" : "rgba(255,255,255,0.12)" }}
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
