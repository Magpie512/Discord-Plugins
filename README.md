> **Disclaimer:**
> Modifying Discord is against Discord’s Terms of Service. I do not advise doing so. That being said, Use Vencord at your own risk.
> This guide only covers the official, open-source build process.

All of this code is from my educational journey and once again I do not condone breaking any ToS. This is just TSX mod application to prove I actually can interpret already made code and make my own >:D

### Plugin List

* **Popout User Video**
Allowing users to pop out streams singularly. Ideal for Edaters. #Honest

---

### Prerequisites (All Platforms)

Before building, ensure you have:

* **Git**
* **Node.js 18+**
* **pnpm** (Required for Vencord/Vesktop builds)

---

## 1. Customizing Vencord (The Engine)

Since Vesktop relies on Vencord for plugins, you must first build a version of Vencord that includes your homemade files.

### Step A: Setup

1. **Clone the repository:**
```sh
git clone https://github.com/Vencord/Vencord.git
cd Vencord
pnpm install

```



### Step B: Adding Homemade Plugins

2. **Add your code:**
Navigate to `src/userplugins`. Create this folder if it does not exist. Place your plugin folder (e.g., `PopoutVideo`) inside.
3. **Build:**
```sh
pnpm build

```



---

## 2. Building & Linking Vesktop

To actually use these plugins in the Vesktop client, follow the steps for your specific OS.

### Windows

1. **Clone and Install:**

```sh
   git clone https://github.com/Vencord/Vesktop.git
   cd Vesktop
   pnpm install

```

2. **Point to your Vencord:**
Vesktop usually fetches Vencord automatically. To use your **homemade** build, you can use `pnpm link`:
* In your **Vencord** folder: `pnpm link --global`
* In your **Vesktop** folder: `pnpm link --global vencord`


3. **Build & Launch:**

```sh
   pnpm build
   pnpm start

```

### MacOS (Untested)

1. **Install via Homebrew:**

```sh
   brew install git node
   npm install -g pnpm

```

2. **Clone and Build:**

```sh
   git clone https://github.com/Vencord/Vesktop.git
   cd Vesktop
   pnpm install
   pnpm build
   pnpm start

```

### Linux (Untested)

1. **Install Dependencies:**

```sh
   sudo apt update
   sudo apt install git nodejs npm
   npm install -g pnpm

```

2. **Clone and Build:**

```sh
   git clone https://github.com/Vencord/Vesktop.git
   cd Vesktop
   pnpm install
   pnpm build

```

3. **Flatpak Note:** If using the Flatpak version of Discord, remember that Vesktop acts as a standalone client and does not require the `pnpm inject --flatpak` command used by the standard Vencord installer.

---

## 3. Updating & Maintenance

When you make changes to your TSX plugin code:

1. Go to your **Vencord** directory.
2. Run `pnpm build` to recompile the plugin.
3. Restart **Vesktop**. Your changes will be reflected immediately upon the next app launch.

```
