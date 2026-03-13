import { initSender } from "./sender";
import { initReceiver } from "./receiver";
import "./style.css";

const app = document.getElementById("app")!;

function render() {
  const hash = window.location.hash || "#";

  // Header is always visible
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <h1>Qir Drop</h1>
    <p class="tagline">透過 QR Code 離線傳送檔案</p>
    <nav>
      <a href="#send" class="${hash === "#send" ? "active" : ""}">📤 發送</a>
      <a href="#receive" class="${hash === "#receive" ? "active" : ""}">📥 接收</a>
    </nav>
  `;

  const content = document.createElement("div");
  content.className = "content";

  app.innerHTML = "";
  app.appendChild(header);
  app.appendChild(content);

  if (hash === "#send") {
    initSender(content);
  } else if (hash === "#receive") {
    initReceiver(content);
  } else {
    content.innerHTML = `
      <div class="home">
        <div class="home-cards">
          <a href="#send" class="home-card">
            <span class="icon">📤</span>
            <h3>發送檔案</h3>
            <p>選擇檔案，產生 QR Code 動畫</p>
          </a>
          <a href="#receive" class="home-card">
            <span class="icon">📥</span>
            <h3>接收檔案</h3>
            <p>掃描 QR Code 動畫，接收檔案</p>
          </a>
        </div>
      </div>
    `;
  }
}

window.addEventListener("hashchange", render);
render();
