require("./workspace-scroll.cjs");
let connected = false;
const listeners = new Set();
const onChanged = window.coxswain.onChanged;
Object.assign(window.fixture, { failConnection: false });
Object.assign(window.coxswain, {
  currentUser: async () => ({
    status: "signed-in",
    login: "fixture",
    name: "Fixture",
    avatarUrl: "",
  }),
  getGuideSettings: async () => ({ agent: "claude", model: "", effort: "" }),
  getDefaultPrompts: async () => ({
    guide: { value: "Guide", defaultValue: "Guide" },
    review: { value: "Review", defaultValue: "Review" },
  }),
  listImplementationConnections: async () => [{ id: "amp", name: "Amp", connected }],
  setImplementationConnection: async (_id, value) => {
    if (window.fixture.failConnection && value)
      throw new Error("Sign in to the implementation tool and try again.");
    connected = value;
    listeners.forEach((callback) => callback({ what: "settings" }));
  },
  onChanged: (callback) => {
    listeners.add(callback);
    const off = onChanged(callback);
    return () => {
      listeners.delete(callback);
      off();
    };
  },
});
