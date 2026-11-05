const video = document.querySelector("#demo-video");
const chapters = Array.from(document.querySelectorAll(".chapters button"));
const error = document.querySelector("#play-error");
const soundToggle = document.querySelector(".sound-toggle");

function syncSound() {
  const audible = !video.muted && video.volume > 0;
  soundToggle.textContent = audible ? "关闭配乐" : "开启配乐";
  soundToggle.setAttribute("aria-pressed", String(audible));
}
soundToggle.addEventListener("click", () => {
  const audible = !video.muted && video.volume > 0;
  if (!audible && video.volume === 0) video.volume = 1;
  video.muted = audible;
  syncSound();
});
video.addEventListener("volumechange", syncSound);
syncSound();
soundToggle.hidden = false;

const cover = document.querySelector(".cover");
cover.hidden = false;
cover.addEventListener("click", async () => {
  try {
    await video.play();
    video.focus();
  } catch {
    cover.hidden = true;
    error.hidden = false;
  }
});
video.addEventListener("play", () => { cover.hidden = true; });
video.addEventListener("ended", () => { cover.hidden = false; });

function syncChapter() {
  const current = chapters.filter(button => Number(button.dataset.start) <= video.currentTime).at(-1);
  for (const button of chapters) {
    button.setAttribute("aria-pressed", String(button === current));
  }
}
for (const button of chapters) {
  button.addEventListener("click", async () => {
    try {
      video.currentTime = Number(button.dataset.start);
      syncChapter();
      await video.play();
    } catch (cause) {
      if (cause.name !== "AbortError") error.hidden = false;
    }
  });
}
video.addEventListener("timeupdate", syncChapter);
video.addEventListener("seeked", syncChapter);
if (new URLSearchParams(location.search).get("chapter") === "reference") {
  const seekToReference = () => {
    video.currentTime = Number(document.querySelector("#chapter-reference").dataset.start);
    syncChapter();
  };
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seekToReference();
  else video.addEventListener("loadedmetadata", seekToReference, {once: true});
}
video.addEventListener("playing", () => { error.hidden = true; });
video.addEventListener("error", () => { error.hidden = false; });

const links = Array.from(document.querySelectorAll("nav a"));
const sections = links.map(link => document.querySelector(link.hash));
function syncNav() {
  const bottom = window.scrollY > 0 &&
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  const current = bottom ? sections.at(-1) :
    sections.filter(section => section.getBoundingClientRect().top <= 100).at(-1) || sections[0];
  for (const link of links) {
    if (link.hash === "#" + current.id) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("scroll", syncNav, { passive: true });
window.addEventListener("resize", syncNav);
syncNav();

const dialog = document.querySelector(".shot-dialog");
const enlarged = dialog.querySelector(".original-shot");
for (const link of document.querySelectorAll(".shot")) {
  link.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    dialog.querySelector("h2").textContent = link.dataset.title;
    enlarged.href = link.href;
    enlarged.firstElementChild.src = link.href;
    enlarged.firstElementChild.alt = link.querySelector("img").alt;
    dialog.showModal();
  });
}
dialog.querySelector("button").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
