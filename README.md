> **Disclaimer:**  
> Modifying Discord is against Discord’s Terms of Service. I do not advise doing so. That being said,
> Use Vencord at your own risk.  
> This guide only covers the official, open‑source build process.

All of this code is from my educational journey and once again I do not condone breaking any Tos this is just TSX mod application to prove i actually can interpret already made code and make my own >:D

### Plugin List

- **Popout User Video**
  Allowing users to pop out streams singularly. Ideal for Edaters. #Honest

### Prerequisites (All Platforms)

Before building Vencord, install:

- **Git**
- **Node.js 18+**
- **pnpm** (recommended by Vencord)

## Windows Tutorial

1. Install pnpm (if you don't have it):

```sh
npm install -g pnpm
```

2. Clone the repository:

```sh
git clone https://github.com/Vencord/Vencord.git
cd Vencord
```

3. Install dependencies:

```sh
pnpm install
```

4. Build Vencord:

```sh
pnpm build
```

5. Inject
```sh
pnpm inject
```

## MacOS Tutorial (Untested)

1. Using Homebrew

```sh
brew install git node
npm install -g pnpm
```

2. Clone the repository:

```sh
git clone https://github.com/Vencord/Vencord.git
cd Vencord
```

3. Install dependencies:

```sh
pnpm install
```

4. Build Vencord

```sh
pnpm build
```

5. Inject into Discord:

```sh
pnpm inject
```

6. Updating

```sh
git pull
pnpm build
pnpm inject
```


## Linux Tutorial (Untested)

Prerequisite:

```sh
sudo apt update
sudo apt install git nodejs npm
npm install -g pnpm
```

1. Clone the repository:

```sh
git clone https://github.com/Vencord/Vencord.git
cd Vencord
```

2. Install dependencies

```sh
pnpm install
```

3. Build Vencord:

```sh
pnpm build
```

4. Inject Vencord (Two options):
```sh
pnpm inject
```

4. If you installed discord via flatpak

```sh
pnpm inject --flatpak
```

5. Updating 

```sh
git pull
pnpm build
pnpm inject
```
