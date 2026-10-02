// The release scripts and the in-image updater share one signing
// implementation. It lives with the updater because that copy ships in the
// image and is what verifies downloaded releases.
export * from '../../docker/app/rootfs/usr/local/lib/reelcraft/updater/signing.mjs';
