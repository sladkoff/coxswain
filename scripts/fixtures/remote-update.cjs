require("./workspace-scroll.cjs");
const changed = new Set();
const onChanged = window.coxswain.onChanged;
let automatic = false;
let finish;
Object.assign(window.fixture, {
  nextMenu: { kind: "dismissed" },
  lastMenu: [],
  remoteCalls: 0,
  automaticCalls: [],
  errors: [],
  finishRemote: (fail) => {
    finish?.(fail);
  },
});
Object.assign(window.coxswain, {
  onChanged: (callback) => {
    changed.add(callback);
    const off = onChanged(callback);
    return () => {
      changed.delete(callback);
      off();
    };
  },
  getAutoUpdate: async () => automatic,
  setAutoUpdate: async (id, enabled) => {
    window.fixture.automaticCalls.push({ id, enabled });
    automatic = enabled;
    changed.forEach((callback) => callback({ what: "workspaces" }));
  },
  updateFromRemote: async () => {
    window.fixture.remoteCalls++;
    await new Promise((resolve, reject) => {
      finish = (fail) => (fail ? reject(new Error("Local edits prevent this update.")) : resolve());
    });
  },
  showSettingsMenu: async (...args) => {
    window.fixture.lastMenu = args;
    const picked = window.fixture.nextMenu;
    window.fixture.nextMenu = { kind: "dismissed" };
    return picked;
  },
  showError: async (error) => {
    window.fixture.errors.push(error);
  },
});
