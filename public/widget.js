(function () {
  var script = document.currentScript;
  var shop = (script && script.getAttribute("data-shop")) || "";
  var API = "/api/v1/shopify";
  if (!shop) return;

  var sessionKey = "af_shop_session";
  var sessionToken = localStorage.getItem(sessionKey);
  if (!sessionToken) {
    sessionToken = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(sessionKey, sessionToken);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function appendMsg(container, who, text) {
    var m = el("div", "af-msg " + who, text);
    container.appendChild(m);
    container.scrollTop = container.scrollHeight;
  }

  async function init() {
    var cfgRes = await fetch(API + "/widget-config?shop=" + encodeURIComponent(shop));
    if (!cfgRes.ok) return;
    var cfg = await cfgRes.json();
    var config = cfg.data || {};

    var btn = el("button", "af-btn", "Chat");
    btn.style.background = config.color || "#111111";
    btn.style.position = "fixed";
    btn.style.bottom = "24px";
    btn.style.zIndex = "99999";
    btn.style.right = (config.position || "bottom-right").indexOf("right") >= 0 ? "24px" : "";
    btn.style.left = (config.position || "bottom-right").indexOf("left") >= 0 ? "24px" : "";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.padding = "12px 16px";
    btn.style.cursor = "pointer";

    var panel = el("div", "af-panel");
    panel.style.position = "fixed";
    panel.style.bottom = "78px";
    panel.style.width = "320px";
    panel.style.height = "420px";
    panel.style.display = "none";
    panel.style.flexDirection = "column";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #ddd";
    panel.style.borderRadius = "14px";
    panel.style.zIndex = "99999";
    panel.style.right = btn.style.right;
    panel.style.left = btn.style.left;

    var header = el("div", "af-head", config.storeName || "ShopAssist");
    header.style.padding = "10px 12px";
    header.style.fontWeight = "600";
    header.style.borderBottom = "1px solid #eee";

    var list = el("div", "af-list");
    list.style.padding = "10px";
    list.style.overflow = "auto";
    list.style.flex = "1";
    appendMsg(list, "assistant", config.greeting || "Hi! How can I help?");

    var form = el("div", "af-form");
    form.style.display = "flex";
    form.style.gap = "8px";
    form.style.padding = "10px";
    form.style.borderTop = "1px solid #eee";

    var input = el("input", "af-input");
    input.placeholder = "Ask about products...";
    input.style.flex = "1";
    input.style.padding = "8px";

    var send = el("button", "af-send", "Send");
    send.style.padding = "8px 12px";

    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(form);
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    btn.addEventListener("click", function () {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });

    async function onSend() {
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      appendMsg(list, "user", text);
      var res = await fetch(API + "/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shop-Domain": shop,
        },
        body: JSON.stringify({ message: text, sessionToken: sessionToken }),
      });
      var json = await res.json();
      appendMsg(list, "assistant", (json.data && json.data.message) || "Unable to reply.");
    }

    send.addEventListener("click", onSend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") onSend();
    });
  }

  init().catch(function () {
    return null;
  });
})();
