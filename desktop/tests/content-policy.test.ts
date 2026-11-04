import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedAppPermission,
  isAllowedRendererUrl,
  isLibraryVideoDownload,
} from "../electron/content-policy";

test("fullscreen is available only to trusted app pages", () => {
  assert.equal(
    isAllowedAppPermission("fullscreen", "coach://app/index.html"),
    true,
  );
  assert.equal(isAllowedAppPermission("fullscreen", "coach://app"), true);
  assert.equal(
    isAllowedAppPermission("fullscreen", "http://127.0.0.1:5178/", true),
    true,
  );
  for (const url of [
    "https://app/",
    "coach://app.evil/",
    "coach://app@evil/",
    "coach://user@app/",
    "http://127.0.0.1:51780/",
    "invalid",
  ]) {
    assert.equal(isAllowedAppPermission("fullscreen", url, true), false, url);
  }
  assert.equal(
    isAllowedAppPermission("fullscreen", "http://127.0.0.1:5178/"),
    false,
  );
  assert.equal(
    isAllowedAppPermission("automatic-fullscreen", "coach://app/"),
    false,
  );
  assert.equal(isAllowedAppPermission("notifications", "coach://app/"), false);
  assert.equal(isAllowedAppPermission("media", "coach://app/"), true);
  assert.equal(
    isAllowedAppPermission("speaker-selection", "coach://app/"),
    true,
  );
  assert.equal(isAllowedRendererUrl("coach://app/index.html"), true);
});

test("library videos cannot be downloaded while training exports remain available", () => {
  const page = "coach://app/index.html";
  assert.equal(
    isLibraryVideoDownload(
      "coach://app/library/hd/squat.mp4",
      "application/octet-stream",
      page,
    ),
    true,
  );
  assert.equal(
    isLibraryVideoDownload(
      "coach://app/library/files/squat.mp4",
      "application/octet-stream",
      page,
    ),
    true,
  );
  assert.equal(
    isLibraryVideoDownload("blob:coach://app/example", "video/mp4", page),
    true,
  );
  assert.equal(
    isLibraryVideoDownload(
      "http://127.0.0.1:5178/library/files/squat.mp4",
      "application/octet-stream",
      "http://127.0.0.1:5178/",
      true,
    ),
    true,
  );
  assert.equal(
    isLibraryVideoDownload("blob:coach://app/example", "text/csv", page),
    false,
  );
  assert.equal(
    isLibraryVideoDownload(
      "blob:coach://app/example",
      "application/json",
      page,
    ),
    false,
  );
});
