// Image imports are bundled as data URLs by esbuild (see build.mjs loader).
declare module '*.png' {
  const url: string;
  export default url;
}
