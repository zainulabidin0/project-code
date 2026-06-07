(function () {
  var script = document.currentScript;
  var scriptUrl = script && script.src ? new URL(script.src, window.location.href) : null;
  var scriptParams = scriptUrl ? scriptUrl.searchParams : new URLSearchParams();

  var shop =
    (script && script.getAttribute("data-shop")) ||
    scriptParams.get("shop") ||
    new URLSearchParams(window.location.search).get("shop") ||
    "";

  var apiBase =
    (script && script.getAttribute("data-api")) ||
    scriptParams.get("api") ||
    (scriptUrl ? scriptUrl.origin : "") ||
    "https://addressfix.dev";
  apiBase = String(apiBase).replace(/\/+$/, "");
  var API = apiBase + "/api/v1/shopify";

  if (!shop) return;

  function generateSecureToken() {
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint8Array(24);
      window.crypto.getRandomValues(arr);
      return (
        "sess_" +
        Array.from(arr)
          .map(function (b) {
            return b.toString(16).padStart(2, "0");
          })
          .join("")
      );
    }
    return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  var sessionKey = "af_sess_" + shop;
  var sessionToken = localStorage.getItem(sessionKey);
  if (!sessionToken) {
    sessionToken = generateSecureToken();
    localStorage.setItem(sessionKey, sessionToken);
  }

  var config = {
    position: "bottom-right",
    color: "#111111",
    greeting: "What would you like to buy today?",
    storeName: "",
  };
  var panelOpen = false;
  var mediaRecorder = null;
  var isRecording = false;

  function injectResponsiveCss() {
    if (document.getElementById("af-responsive-css")) return;
    var style = document.createElement("style");
    style.id = "af-responsive-css";
    style.textContent =
      "#af-panel .af-list{overflow-x:hidden}" +
      "#af-panel .af-products{width:100%;max-width:100%;box-sizing:border-box}" +
      "#af-panel .af-prod{display:flex;flex-direction:column;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden}" +
      "#af-panel .af-prod-img-wrap{width:100%;height:112px;overflow:hidden;border-radius:8px;background:#f4f4f4;flex-shrink:0}" +
      "#af-panel .af-prod-img-wrap img{width:100%!important;height:100%!important;max-width:100%!important;max-height:112px!important;object-fit:cover!important;display:block!important}" +
      "#af-panel .af-prod-info{width:100%;box-sizing:border-box;margin-top:8px}" +
      "#af-panel .af-product-title{line-height:1.35;word-break:break-word;white-space:normal}" +
      "#af-panel .af-product-price{margin-top:4px}" +
      "#af-panel .af-add-cart{width:100%;box-sizing:border-box;white-space:nowrap}" +
      "@media (max-width:480px){#af-panel{width:100vw!important;height:100vh!important;bottom:0!important;right:0!important;left:0!important;border-radius:0!important;position:fixed!important}#af-btn{bottom:16px!important;right:16px!important}}" +
      "@media (min-width:481px) and (max-width:768px){#af-panel{width:calc(100vw - 32px)!important}}";
    document.head.appendChild(style);
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
    return m;
  }

  function renderVariantPicker(product) {
    var options = {};
    (product.variants || []).forEach(function (v) {
      (v.options || []).forEach(function (opt) {
        if (!options[opt.name]) options[opt.name] = {};
        options[opt.name][opt.value] = true;
      });
    });
    var wrap = el("div", "af-variant-picker");
    wrap.style.marginTop = "6px";
    Object.keys(options).forEach(function (name) {
      var group = el("div", "af-option-group");
      var label = el("span", "af-option-label", name);
      label.style.display = "block";
      label.style.fontSize = "11px";
      label.style.color = "#666";
      label.style.marginBottom = "4px";
      group.appendChild(label);
      var btns = el("div", "af-option-btns");
      btns.style.display = "flex";
      btns.style.flexWrap = "wrap";
      btns.style.gap = "4px";
      Object.keys(options[name]).forEach(function (value) {
        var btn = el("button", "af-opt-btn", value);
        btn.type = "button";
        btn.dataset.name = name;
        btn.dataset.value = value;
        btn.style.fontSize = "11px";
        btn.style.padding = "2px 8px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid #ccc";
        btn.style.background = "#fff";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", function () {
          btns.querySelectorAll(".af-opt-btn").forEach(function (b) {
            if (b.dataset.name === name) b.classList.remove("selected");
          });
          btn.classList.add("selected");
          btn.style.background = config.color;
          btn.style.color = "#fff";
          btn.style.borderColor = config.color;
        });
        btns.appendChild(btn);
      });
      group.appendChild(btns);
      wrap.appendChild(group);
    });
    return wrap;
  }

  function getSelectedVariant(product, card) {
    var selected = {};
    card.querySelectorAll(".af-opt-btn.selected").forEach(function (btn) {
      selected[btn.dataset.name] = btn.dataset.value;
    });
    var keys = Object.keys(selected);
    if (!keys.length) return product.variants[0];
    return (
      product.variants.find(function (v) {
        return (v.options || []).every(function (opt) {
          return selected[opt.name] === opt.value;
        });
      }) || product.variants[0]
    );
  }

  function handleAddToCart(variantId, list, accent) {
    return fetch(API + "/cart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shop-Domain": shop,
      },
      body: JSON.stringify({ sessionToken: sessionToken, variantId: variantId, quantity: 1 }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.success && j.data) {
          var msg = j.data.message || "Added to cart.";
          appendMsg(list, "assistant", msg);
          if (j.data.checkoutReady && j.data.checkoutUrl) {
            var checkoutLink = document.createElement("a");
            checkoutLink.href = j.data.checkoutUrl;
            checkoutLink.target = "_blank";
            checkoutLink.rel = "noopener noreferrer";
            checkoutLink.textContent = "Complete order →";
            checkoutLink.style.display = "inline-block";
            checkoutLink.style.marginTop = "6px";
            checkoutLink.style.color = accent;
            list.appendChild(checkoutLink);
          }
          list.scrollTop = list.scrollHeight;
          return true;
        }
        return false;
      });
  }

  function renderSuggestionChips(container, suggestions, accent, sendHandler, chipClass) {
    if (!suggestions || !suggestions.length) return;
    var wrap = el("div", chipClass || "af-suggestions");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "6px";
    wrap.style.marginTop = "8px";
    suggestions.slice(0, 6).forEach(function (label) {
      var chip = el("button", "af-suggestion-chip", label);
      chip.type = "button";
      chip.style.fontSize = "12px";
      chip.style.border = "1px solid " + accent;
      chip.style.background = "#fff";
      chip.style.color = accent;
      chip.style.borderRadius = "999px";
      chip.style.padding = "4px 10px";
      chip.style.cursor = "pointer";
      chip.addEventListener("click", function () {
        sendHandler(label);
      });
      wrap.appendChild(chip);
    });
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
  }

  function renderClarificationSuggestions(container, suggestions, accent, sendHandler) {
    renderSuggestionChips(container, suggestions, accent, sendHandler, "af-suggestions");
  }

  function renderProducts(container, products, accent, selectedProductId, conversationStage) {
    if (!products || !products.length) return;
    var hideAddToCart =
      conversationStage === "collecting_checkout" ||
      conversationStage === "checkout_ready" ||
      conversationStage === "completed";
    var wrap = el("div", "af-products");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";
    wrap.style.marginTop = "6px";
    wrap.style.width = "100%";
    wrap.style.maxWidth = "100%";
    wrap.style.boxSizing = "border-box";
    products.forEach(function (p) {
      var card = el("div", "af-prod");
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.width = "100%";
      card.style.maxWidth = "100%";
      card.style.boxSizing = "border-box";
      card.style.border = "1px solid #eee";
      card.style.borderRadius = "10px";
      card.style.padding = "8px";
      card.style.overflow = "hidden";
      if (selectedProductId && p.id === selectedProductId) {
        card.style.border = "2px solid " + accent;
        card.style.background = "#fafafa";
      }

      if (p.image) {
        var imgWrap = el("div", "af-prod-img-wrap");
        var img = document.createElement("img");
        img.className = "af-prod-img";
        img.src = p.image;
        img.alt = p.title || "";
        img.loading = "lazy";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.maxWidth = "100%";
        img.style.objectFit = "cover";
        img.style.display = "block";
        img.onerror = function () {
          imgWrap.style.display = "none";
        };
        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
      }

      var info = el("div", "af-prod-info");
      var title = el("div", "af-product-title", p.title || "");
      title.style.fontWeight = "600";
      title.style.fontSize = "13px";
      var price = el("div", "af-product-price", (p.price || "") + " " + (p.currency || ""));
      price.style.fontSize = "12px";
      price.style.color = accent;
      info.appendChild(title);
      info.appendChild(price);

      var hasVariants = p.variants && p.variants.length > 1;
      if (hasVariants) info.appendChild(renderVariantPicker(p));

      if (p.variants && p.variants.length && !hideAddToCart) {
        var btn = el("button", "af-add-cart", "Add to cart");
        btn.type = "button";
        btn.style.marginTop = "8px";
        btn.style.fontSize = "12px";
        btn.style.padding = "8px 10px";
        btn.style.borderRadius = "8px";
        btn.style.border = "none";
        btn.style.background = accent;
        btn.style.color = "#fff";
        btn.style.cursor = "pointer";
        btn.style.width = "100%";
        btn.style.boxSizing = "border-box";
        btn.onclick = function () {
          var variant = hasVariants ? getSelectedVariant(p, card) : p.variants[0];
          if (!variant || !variant.id) {
            appendMsg(container, "assistant", "Please select a size/colour before adding to cart.");
            return;
          }
          btn.disabled = true;
          btn.textContent = "Adding…";
          handleAddToCart(variant.id, container, accent)
            .then(function (ok) {
              btn.textContent = ok ? "Added!" : "Retry";
              btn.disabled = !ok;
            })
            .catch(function () {
              btn.textContent = "Retry";
              btn.disabled = false;
            });
        };
        info.appendChild(btn);
      }
      card.appendChild(info);
      wrap.appendChild(card);
    });
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
  }

  function getSupportedMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return null;
  }

  async function init() {
    injectResponsiveCss();
    try {
      var cfgRes = await fetch(API + "/widget-config?shop=" + encodeURIComponent(shop));
      if (cfgRes.ok) {
        var cfg = await cfgRes.json();
        if (cfg && cfg.data) {
          if (cfg.data.position) config.position = cfg.data.position;
          if (cfg.data.color) config.color = cfg.data.color;
          if (cfg.data.greeting) config.greeting = cfg.data.greeting;
          if (cfg.data.storeName) config.storeName = cfg.data.storeName;
        }
      }
    } catch (e) {}

    var btn = el("button", "af-btn", "Chat");
    btn.id = "af-btn";
    btn.style.background = config.color;
    btn.style.position = "fixed";
    btn.style.bottom = "24px";
    btn.style.zIndex = "99999";
    btn.style.right = config.position.indexOf("right") >= 0 ? "24px" : "";
    btn.style.left = config.position.indexOf("left") >= 0 ? "24px" : "";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.padding = "12px 16px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 4px 16px rgba(0,0,0,0.2)";

    var panel = el("div", "af-panel");
    panel.id = "af-panel";
    panel.style.position = "fixed";
    panel.style.bottom = "78px";
    panel.style.width = "360px";
    panel.style.maxWidth = "calc(100vw - 24px)";
    panel.style.height = "480px";
    panel.style.maxHeight = "calc(100vh - 100px)";
    panel.style.display = "none";
    panel.style.flexDirection = "column";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #ddd";
    panel.style.borderRadius = "14px";
    panel.style.zIndex = "99999";
    panel.style.right = btn.style.right;
    panel.style.left = btn.style.left;
    panel.style.boxShadow = "0 8px 32px rgba(0,0,0,0.15)";

    var header = el("div", "af-head", config.storeName || "ShopAssist");
    header.style.padding = "10px 12px";
    header.style.fontWeight = "600";
    header.style.borderBottom = "1px solid #eee";
    header.style.background = config.color;
    header.style.color = "#fff";
    header.style.borderTopLeftRadius = "14px";
    header.style.borderTopRightRadius = "14px";

    var list = el("div", "af-list");
    list.style.padding = "10px";
    list.style.overflow = "auto";
    list.style.overflowX = "hidden";
    list.style.flex = "1";
    appendMsg(list, "assistant", config.greeting);

    var form = el("div", "af-form");
    form.style.display = "flex";
    form.style.gap = "6px";
    form.style.padding = "10px";
    form.style.borderTop = "1px solid #eee";
    form.style.alignItems = "center";

    var input = el("input", "af-input");
    input.placeholder = "Tell me what you're looking for…";
    input.style.flex = "1";
    input.style.padding = "8px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #ccc";

    var mic = el("button", "af-mic", "🎤");
    mic.id = "af-mic";
    mic.type = "button";
    mic.title = "Voice";
    mic.style.borderRadius = "10px";
    mic.style.border = "1px solid #ccc";
    mic.style.padding = "6px 8px";
    mic.style.cursor = "pointer";

    var send = el("button", "af-send", "Send");
    send.type = "button";
    send.style.padding = "8px 12px";
    send.style.borderRadius = "10px";
    send.style.border = "none";
    send.style.background = config.color;
    send.style.color = "#fff";
    send.style.cursor = "pointer";

    form.appendChild(input);
    form.appendChild(mic);
    form.appendChild(send);
    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(form);
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function toggle() {
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? "flex" : "none";
    }
    btn.addEventListener("click", toggle);

    async function onSend(prefilledText) {
      var text = (prefilledText || input.value || "").trim();
      if (!text) return;
      input.value = "";
      appendMsg(list, "user", text);
      var typing = el("div", "af-typing", "…");
      typing.style.fontSize = "13px";
      typing.style.color = "#888";
      list.appendChild(typing);
      list.scrollTop = list.scrollHeight;
      try {
        var res = await fetch(API + "/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shop-Domain": shop,
          },
          body: JSON.stringify({ message: text, sessionToken: sessionToken }),
        });
        var json = await res.json();
        typing.remove();
        var msg = (json.data && json.data.message) || "Unable to reply.";
        appendMsg(list, "assistant", msg);
        if (json.data && json.data.products && json.data.products.length) {
          var selectedId =
            json.data.selectedProduct && json.data.selectedProduct.id
              ? json.data.selectedProduct.id
              : null;
          renderProducts(list, json.data.products, config.color, selectedId, json.data.conversationStage);
        }
        if (json.data && json.data.productSuggestions && json.data.productSuggestions.length) {
          renderSuggestionChips(list, json.data.productSuggestions, config.color, onSend, "af-product-suggestions");
        }
        if (json.data && json.data.needsClarification && json.data.suggestions) {
          renderClarificationSuggestions(list, json.data.suggestions, config.color, onSend);
        }
        if (json.data && json.data.checkoutReady && json.data.cartAction && json.data.cartAction.checkoutUrl) {
          var a = document.createElement("a");
          a.href = json.data.cartAction.checkoutUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "Complete order →";
          a.style.display = "inline-block";
          a.style.marginTop = "8px";
          a.style.color = config.color;
          list.appendChild(a);
          list.scrollTop = list.scrollHeight;
        }
      } catch (e) {
        typing.remove();
        appendMsg(list, "assistant", "Connection error. Try again.");
      }
    }

    send.addEventListener("click", onSend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") onSend();
    });

    mic.addEventListener("click", async function () {
      if (!window.MediaRecorder) {
        appendMsg(list, "assistant", "Voice input is not supported in your browser. Please type your message.");
        return;
      }
      var mimeType = getSupportedMimeType();
      if (!mimeType) {
        appendMsg(list, "assistant", "Your browser does not support voice recording. Please type instead.");
        return;
      }
      if (!isRecording) {
        try {
          var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          var chunks = [];
          mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
          mediaRecorder.ondataavailable = function (e) {
            if (e.data.size > 0) chunks.push(e.data);
          };
          mediaRecorder.onstop = async function () {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            var blob = new Blob(chunks, { type: mimeType });
            var ext = mimeType.indexOf("mp4") >= 0 ? "voice.mp4" : "voice.webm";
            var fd = new FormData();
            fd.append("audio", blob, ext);
            appendMsg(list, "assistant", "Transcribing…");
            try {
              var r = await fetch(API + "/voice", {
                method: "POST",
                headers: { "X-Shop-Domain": shop },
                body: fd,
              });
              var j = await r.json();
              list.removeChild(list.lastChild);
              if (j.success && j.data && j.data.transcript) {
                input.value = j.data.transcript;
                await onSend();
              } else {
                appendMsg(list, "assistant", "Could not transcribe audio.");
              }
            } catch (err) {
              if (list.lastChild) list.removeChild(list.lastChild);
              appendMsg(list, "assistant", "Voice failed. Type your message instead.");
            }
          };
          mediaRecorder.start(250);
          isRecording = true;
          mic.classList.add("recording");
          mic.style.background = "#f66";
          mic.style.color = "#fff";
        } catch (err) {
          if (err && err.name === "NotAllowedError") {
            appendMsg(list, "assistant", "Microphone permission denied. Please allow access in your browser settings.");
          } else {
            appendMsg(list, "assistant", "Could not start recording. Please type your message instead.");
          }
        }
      } else {
        if (mediaRecorder) mediaRecorder.stop();
        isRecording = false;
        mic.classList.remove("recording");
        mic.style.background = "";
        mic.style.color = "";
      }
    });
  }

  init().catch(function () {
    return null;
  });
})();
