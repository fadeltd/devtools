/**
 * The largest table Copy formatted will build. Past this the HTML runs to
 * megabytes, which would cross from the worker on every parse, and no chat or
 * document takes a paste that size as a table anyway.
 *
 * In a module of its own because the page needs the number for a tooltip and
 * must not import a value from the worker file.
 */
export const RICH_CELL_LIMIT = 10_000
