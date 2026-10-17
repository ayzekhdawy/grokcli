/**
 * Brand marks for known custom-provider presets
 * (DeepSeek, OpenRouter, Amux, OpenCode Go, Volcengine Ark, Zhipu, …).
 * Amux / OpenCode Go use currentColor so they follow light/dark theme;
 * OpenRouter is purple in light theme, currentColor (ink) in dark;
 * DeepSeek / Volcano Ark keep brand colors;
 * Zhipu tile inverts in dark theme (official #2D2D2D + white Z).
 */

import { memo, useId } from "react";
import {
  resolveProviderBrandId,
  type ProviderBrandId,
} from "@/lib/providerPresets";

export type ProviderBrandIconProps = {
  brand?: ProviderBrandId | null;
  /** Resolve brand from provider id / base URL when `brand` is omitted. */
  providerId?: string | null;
  baseUrl?: string | null;
  className?: string;
  title?: string;
  size?: number;
};

function AmuxMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--amux ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {/* currentColor → follows theme (light/dark) */}
      <path
        d="M4 96 C4 96, 24 12, 64 12 C104 12, 124 96, 124 96 Q124 102, 118 102 C94 102, 92 64, 64 64 C36 64, 34 102, 10 102 Q4 102, 4 96 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** OpenRouter mark (src/assets/providers/openrouter.svg). Wide word-icon. */
function OpenRouterMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  // Source art is ~365.6×258.3 (≈28.3×20). Keep height = size and width
  // proportional so the mark is not squashed in square avatars.
  const height = size;
  const width = Math.round((size * 365.556) / 258.298);
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--openrouter ${className}`.trim()}
      width={width}
      height={height}
      viewBox="19.82 17.199 365.556 258.298"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d="M303.9475,17.19926c42.79734,0,77.48933,34.69327,77.48933,77.48933s-34.69199,77.48933-77.48933,77.48933l76.86166,76.86244c9.76367,9.76313,2.84903,26.45667-10.95697,26.45667h-220.88335c-71.32686,0-129.14889-57.82202-129.14889-129.14889S77.64197,17.19926,148.96884,17.19926h154.97866ZM148.96884,68.85881c-42.79607,0-77.48933,34.69327-77.48933,77.48933s34.69327,77.48933,77.48933,77.48933,77.48933-34.69327,77.48933-77.48933-34.69327-77.48933-77.48933-77.48933Z" />
    </svg>
  );
}

/** OpenCode rectangular frame mark (from docs/svg/opencode go.svg). */
function OpenCodeGoMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  // Source art is 24×30; keep height = size and width proportional so the
  // tall frame does not look squashed in square avatars.
  const height = size;
  const width = Math.round((size * 24) / 30);
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--opencode-go ${className}`.trim()}
      width={width}
      height={height}
      viewBox="0 0 24 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {/* currentColor → follows theme (light/dark); evenodd cuts the inner hole */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z"
        fill="currentColor"
      />
    </svg>
  );
}

function DeepSeekMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--deepseek ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 27 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M26.5174 3.39471C26.235 3.2567 26.1137 3.52006 25.9487 3.65346C25.8923 3.69659 25.8446 3.75294 25.7969 3.80469C25.3846 4.24516 24.9027 4.53439 24.2737 4.49989C23.3536 4.44814 22.5682 4.73737 21.8735 5.44119C21.7258 4.57349 21.2353 4.0554 20.4889 3.72304C20.0985 3.55054 19.7034 3.37746 19.4297 3.00197C19.2388 2.73459 19.1865 2.43673 19.091 2.14289C19.0301 1.96579 18.9697 1.78466 18.7656 1.75418C18.5442 1.71968 18.4574 1.90541 18.3705 2.06067C18.0232 2.69549 17.8887 3.39471 17.9019 4.10313C17.9324 5.6965 18.6051 6.96556 19.9421 7.86834C20.0939 7.97184 20.133 8.07535 20.0852 8.22658C19.9938 8.53766 19.8857 8.83955 19.7903 9.15063C19.7293 9.34901 19.6384 9.39271 19.4257 9.30588C18.692 8.9994 18.0583 8.54571 17.4982 7.99772C16.5477 7.07827 15.6881 6.06336 14.6162 5.26869C14.3644 5.08296 14.1125 4.91045 13.8521 4.746C12.7584 3.68394 13.9952 2.81164 14.2816 2.70814C14.5812 2.60003 14.3857 2.22857 13.4179 2.23317C12.4502 2.2372 11.5646 2.56151 10.4359 2.99335C10.2708 3.05832 10.0972 3.10547 9.91951 3.14457C8.8954 2.95022 7.83162 2.90709 6.72069 3.03245C4.62877 3.26533 2.95777 4.25436 1.72954 5.94261C0.254043 7.97184 -0.0932678 10.2777 0.33167 12.6824C0.778458 15.2171 2.07225 17.3153 4.06008 18.9558C6.12152 20.6567 8.49577 21.4905 11.2047 21.3306C12.8498 21.2358 14.6812 21.0155 16.7473 19.2669C17.2682 19.5262 17.8151 19.6297 18.7219 19.7074C19.4205 19.7723 20.0933 19.6729 20.6143 19.5648C21.4302 19.3923 21.3739 18.6367 21.0789 18.4981C18.6874 17.3843 19.2124 17.8374 18.7351 17.4706C19.9501 16.033 21.8063 13.4776 22.379 9.99821C22.4353 9.61409 22.5072 9.073 22.4986 8.76192C22.494 8.57216 22.5377 8.49856 22.7545 8.47671C23.3536 8.40771 23.935 8.24383 24.4692 7.94999C26.0188 7.10357 26.6439 5.71318 26.7911 4.04678C26.8129 3.79204 26.7865 3.52869 26.5174 3.39471ZM13.0143 18.3946C10.6964 16.5724 9.5722 15.9726 9.10816 15.9985C8.67402 16.0244 8.75222 16.5212 8.84768 16.8449C8.94773 17.1646 9.07768 17.3849 9.25996 17.6655C9.38589 17.8512 9.47272 18.1272 9.13404 18.3348C8.38766 18.7965 7.08985 18.1796 7.0289 18.1491C5.51833 17.2595 4.25559 16.0853 3.36546 14.4793C2.50581 12.9337 2.0067 11.2753 1.92447 9.50542C1.90262 9.07818 2.02855 8.92695 2.45406 8.84932C3.01413 8.74582 3.59144 8.72397 4.15093 8.80619C6.51656 9.15178 8.53027 10.2092 10.2185 11.8848C11.1822 12.8388 11.9114 13.979 12.6623 15.0929C13.461 16.2757 14.3201 17.4027 15.4144 18.3268C15.8008 18.6505 16.109 18.8966 16.404 19.0783C15.5144 19.1778 14.0297 19.1991 13.0143 18.3958V18.3946ZM14.1252 11.2489C14.1252 11.0591 14.277 10.9079 14.4679 10.9079C14.511 10.9079 14.5501 10.9165 14.5852 10.9292C14.6329 10.9464 14.6766 10.9723 14.7111 11.0114C14.7721 11.0718 14.8066 11.158 14.8066 11.2489C14.8066 11.4386 14.6548 11.5899 14.4639 11.5899C14.273 11.5899 14.1252 11.4386 14.1252 11.2489ZM17.5759 13.0188C17.3545 13.1096 17.1331 13.1873 16.9203 13.1959C16.5903 13.2131 16.2303 13.0791 16.0348 12.9153C15.7312 12.6605 15.5139 12.5179 15.423 12.0734C15.3839 11.8837 15.4057 11.5899 15.4402 11.4214C15.5185 11.0585 15.4316 10.8257 15.1757 10.614C14.9676 10.4415 14.7025 10.3938 14.4115 10.3938C14.3029 10.3938 14.2034 10.3461 14.1292 10.3076C14.0079 10.2472 13.9078 10.096 14.0033 9.91023C14.0338 9.84985 14.1815 9.70322 14.216 9.67734C14.6111 9.45251 15.0665 9.52612 15.488 9.6946C15.8784 9.85445 16.174 10.1477 16.5989 10.5623C17.033 11.0631 17.1112 11.2011 17.3585 11.5772C17.554 11.871 17.7317 12.1729 17.8536 12.5185C17.9272 12.7341 17.8317 12.9107 17.5759 13.0188Z"
        fill="#4D6BFE"
      />
    </svg>
  );
}

/** Volcengine Ark (火山方舟) mark — brand cyan/blue (docs/svg/volcano-ark.svg). */
function VolcanoArkMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  // Unique suffix so multiple icons on one page do not collide on mask/clip ids.
  const uid = `va-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--volcano-ark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g clipPath={`url(#${uid}-clip)`}>
        <mask
          id={`${uid}-m1`}
          width="7"
          height="11"
          x="0"
          y="12"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "luminance" }}
        >
          <path
            fill="#fff"
            d="M.348 22.254h6.344L3.819 13.22a.318.318 0 0 0-.606 0z"
          />
        </mask>
        <g mask={`url(#${uid}-m1)`}>
          <path fill="#00DCFF" d="M7.041 12.604H0v10.004h7.041z" />
        </g>
        <mask
          id={`${uid}-m2`}
          width="9"
          height="12"
          x="15"
          y="11"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "luminance" }}
        >
          <path
            fill="#fff"
            d="M15.773 22.266h7.362l-3.377-10.642a.318.318 0 0 0-.607 0z"
          />
        </mask>
        <g mask={`url(#${uid}-m2)`}>
          <path fill="#00DCFF" d="M23.489 11.008h-8.06v11.611h8.06z" />
        </g>
        <mask
          id={`${uid}-m3`}
          width="14"
          height="22"
          x="7"
          y="1"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "luminance" }}
        >
          <path
            fill="#fff"
            d="M7.012 22.265h13.58L14.105 1.956a.315.315 0 0 0-.4-.205.32.32 0 0 0-.206.205z"
          />
        </mask>
        <g mask={`url(#${uid}-m3)`}>
          <path fill="#006AFF" d="M20.946 1.34H6.668v21.279h14.278z" />
        </g>
        <mask
          id={`${uid}-m4`}
          width="12"
          height="17"
          x="2"
          y="6"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "luminance" }}
        >
          <path
            fill="#fff"
            d="M2.886 22.267h10.28L8.328 7.113a.315.315 0 0 0-.401-.206.32.32 0 0 0-.206.206L2.883 22.267z"
          />
        </mask>
        <g mask={`url(#${uid}-m4)`}>
          <path fill="#006AFF" d="M13.516 6.496H2.539v16.125h10.977z" />
        </g>
        <mask
          id={`${uid}-m5`}
          width="10"
          height="14"
          x="5"
          y="9"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "luminance" }}
        >
          <path
            fill="#fff"
            d="M5.734 22.267h8.694L10.384 9.68a.315.315 0 0 0-.603 0L5.738 22.267z"
          />
        </mask>
        <g mask={`url(#${uid}-m5)`}>
          <path fill="#00DCFF" d="M14.785 9.066h-9.39v13.555h9.39z" />
        </g>
      </g>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path fill="#fff" d="M0 0h24v24H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Official Zhipu / Z.AI mark (`docs/svg/zhipu.svg`). Tile + Z invert in dark theme. */
function ZhipuMark({
  className = "",
  title,
  size = 20,
}: {
  className?: string;
  title?: string;
  size?: number;
}) {
  return (
    <svg
      className={`provider-brand-icon provider-brand-icon--zhipu ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path
        className="zhipu-mark__tile"
        d="M24.51 28.51H5.49c-2.21 0-4-1.79-4-4V5.49c0-2.21 1.79-4 4-4h19.03c2.21 0 4 1.79 4 4v19.03c0 2.21-1.79 4-4 4z"
      />
      <path
        className="zhipu-mark__z"
        d="M15.47 7.1 14.17 8.95c-.2.29-.54.47-.9.47H6.17V7.09h9.3z"
      />
      <polygon
        className="zhipu-mark__z"
        points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1"
      />
      <path
        className="zhipu-mark__z"
        d="M14.53 22.91 15.84 21.05c.2-.29.54-.47.9-.47h7.09v2.33H14.53z"
      />
    </svg>
  );
}

export const ProviderBrandIcon = memo(function ProviderBrandIcon({
  brand,
  providerId,
  baseUrl,
  className = "",
  title,
  size = 20,
}: ProviderBrandIconProps) {
  const id =
    brand ??
    resolveProviderBrandId({ providerId, baseUrl });
  if (id === "amux") {
    return <AmuxMark className={className} title={title} size={size} />;
  }
  if (id === "openrouter") {
    return <OpenRouterMark className={className} title={title} size={size} />;
  }
  if (id === "deepseek") {
    return <DeepSeekMark className={className} title={title} size={size} />;
  }
  if (id === "opencode-go") {
    return <OpenCodeGoMark className={className} title={title} size={size} />;
  }
  if (id === "volcano-ark") {
    return <VolcanoArkMark className={className} title={title} size={size} />;
  }
  if (id === "zhipu") {
    return <ZhipuMark className={className} title={title} size={size} />;
  }
  return null;
});

/** Letter fallback when no brand mark is available. */
export function providerAvatarLetter(
  nameOrId: string | null | undefined,
): string {
  const s = (nameOrId ?? "").trim();
  return Array.from(s)[0]?.toUpperCase() || "P";
}
