/**
 * How SPDD stage files are named and matched to a feature. Pure functions, no file access.
 *
 * Stage file name, as the SPDD commands write it: <KEY>-<YYYYMMDD[HHMM]>-[<Tag>]-<slug>[-V2].md.
 * KEY may hold hyphens (a ticket such as GGQPA-169); Tag is Requirements, Analysis, Feat, Create…
 */
export const STAGE_FILE = /^(.+?)-(\d{8}(?:\d{4})?)-\[[^\]]+\]-(.+?)(?:-V\d+)?\.md$/;

/** One slug names the other's feature when equal, or when one adds a prefix such as web- or api-. */
export const sameFeature = (a, b) => a === b || a.endsWith(`-${b}`) || b.endsWith(`-${a}`);

/** Escape a slug for use inside a RegExp. */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stage files of one slug: an optional prefix such as web- or api- before it, an optional -V2 after it. */
export const slugFiles = (files, slug) =>
  slug ? files.filter((p) => new RegExp(`\\]-(.+-)?${reEscape(slug)}(-V\\d+)?\\.md$`).test(p)) : [];
