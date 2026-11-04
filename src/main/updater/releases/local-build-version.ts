// Matches the suffix config/scripts/build-mac-local.mjs adds to the package version.
const LOCAL_BUILD_VERSION_SUFFIX = /[-.]local\.\d+\.[0-9A-Za-z-]+$/

/** Local builds are replaced by hand, so they must not take updates from the official release feed. */
export function isLocalBuildVersion(version: string): boolean {
  return LOCAL_BUILD_VERSION_SUFFIX.test(version)
}
