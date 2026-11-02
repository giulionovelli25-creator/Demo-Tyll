// Where the demo's live records are kept. The path is built here, as plain text at run time, on purpose: when the bundler
// can read a path to a file, it treats that file as part of the code, and the dev server reloads every open page each time
// the file is written. Saving a record would then reload the page, and that reload would save another record.
export const dataFile = (name: string) => `${process.cwd()}/.data/${name}`;
