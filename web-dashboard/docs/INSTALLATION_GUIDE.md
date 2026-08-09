# 🚀 DCS Web Dashboard - Complete Installation Guide

This guide covers everything needed to deploy the DCS Web Dashboard from scratch on a brand new Windows Server.

---

## 🛑 Step 1: Prerequisites
Before you begin, ensure the new server has the following installed:
1. **Node.js (v18 or newer)** - Download from [nodejs.org](https://nodejs.org/). Make sure to check the box that adds it to your PATH during installation.
2. **NSSM (Non-Sucking Service Manager)** - Download the `.zip` from [nssm.cc](https://nssm.cc/) and extract it to a permanent folder (e.g., `C:\nssm`).
3. **DCS-gRPC Mod** - Installed in your DCS `Saved Games\Scripts` folder and actively running.
4. **DCS-Dynamic-Weather (Optional)** - The Python preset script is only required if you plan to use the dynamic Weather tab. If you don't use it, you can skip this.

---

## 📥 Step 2: Download the Dashboard
1. On the new server, download or clone the repository containing the `web-dashboard` folder.
2. Place the `web-dashboard` folder wherever you want it to live permanently (e.g., `C:\Users\admin\Saved Games\DCS.openbeta_server\Scripts\Web Dashboard\web-dashboard`).

---

## ⚙️ Step 3: Configure the Environment
You must create a configuration file for the dashboard to know how to authenticate users and where to find DCS files.

1. Inside the `web-dashboard` folder, create a new file named exactly **`.env.local`**.
2. Open it in Notepad and paste the following template:

```ini
# Fallback Master Password
ADMIN_PASSWORD=your_super_secret_password

# The public IP of this NEW server, and the port the dashboard runs on
NEXT_PUBLIC_APP_URL=http://YOUR_NEW_IP:3001

# Discord Authentication (See Step 4)
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_ADMIN_ROLE_ID=role_id_1,role_id_2

# --- OPTIONAL MODULES ---

# Security Whitelist for the Task Manager tab
DCS_TASK_WHITELIST="DCS Web Server Console, DCSAdminBot, STACY'S BRAA"

# Absolute path to your DCS Saved Games folder (Required if dashboard is not installed in Saved Games\Scripts\Web Dashboard\web-dashboard)
DCS_SAVED_GAMES_DIR="C:\Users\admin\Saved Games\DCS.openbeta_server"

# Absolute path to the DCS Dynamic Weather script folder
# Leave these completely blank or delete them if this server doesn't use the dynamic weather module!
DCS_DYNAMIC_WEATHER_DIR="C:\Users\admin\Saved Games\DCS.openbeta_server\Missions\Dynamic_Weather_mission"
PYTHON_EXE="python"

# Native Mobile App API Key
MOBILE_API_KEY="generate_a_random_string_here"
```
3. Update `NEXT_PUBLIC_APP_URL` to match the exact IP of the new server.

---

## 👾 Step 4: Discord Application Setup
If you are using a new IP, you must update your Discord Developer Application so it allows logins from the new server!

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your Application (or create a new one).
3. Go to the **OAuth2** tab.
4. Under **Redirect URIs**, add the callback URL for your new server IP:
   `http://YOUR_NEW_IP:3001/api/auth/callback`
5. *(Optional)* If you created a brand new application, copy the Client ID and Client Secret into your `.env.local` file.

---

## 🏗️ Step 5: Install Dependencies & Build
You must compile the application into a highly optimized production build.

1. Open a **Command Prompt** and navigate to your dashboard folder:
   `cd "C:\path\to\your\web-dashboard"`
2. Install all required Node.js packages:
   `npm install`
3. Compile the production build:
   `npm run build`
4. Wait for it to say `Compiled successfully`.

---

## 🛡️ Step 6: Install as a Windows Service (NSSM)
To ensure the dashboard runs silently in the background, survives reboots, and doesn't freeze, we install it as a Windows Service.

1. Open an **Administrator Command Prompt**.
2. Navigate to where you extracted NSSM:
   `cd C:\nssm\win64`
3. Run the install command:
   `nssm install "DCS Web Dashboard"`
4. In the GUI that opens, configure the following:
   
   **Application Tab:**
   - **Path:** `C:\Program Files\nodejs\npm.cmd` *(or wherever your Node.js is installed)*
   - **Directory:** `C:\path\to\your\web-dashboard` *(CRITICAL: Must point to your exact dashboard folder!)*
   - **Arguments:** `start`

   **Details Tab:**
   - **Display name:** `DCS Web Dashboard`
   - **Startup type:** `Automatic`

   **Log on Tab:**
   - You can usually leave this as the default **Local System account**. 
   - *(Note: If the dashboard later gives you errors about not having permission to read DCS files inside the `Saved Games` folder, you can come back here and change it to the exact `admin` account that DCS runs under).*

   **I/O Tab:**
   - Leave `Input` completely blank.
   - **Output (stdout):** `C:\path\to\your\web-dashboard\logs\dashboard-out.log`
   - **Error (stderr):** `C:\path\to\your\web-dashboard\logs\dashboard-error.log`

5. Click **Install service**.
6. Open the Windows `services.msc` panel, find "DCS Web Dashboard", right-click it, and select **Start**.

---

## 🧱 Step 7: Open Firewall Port
Finally, you must tell Windows to allow outside internet traffic to reach the dashboard.

> ⚠️ **SECURITY WARNING: HTTP vs HTTPS (SSL)**
> By default, Node.js runs this dashboard over raw HTTP. This means all traffic (including Discord OAuth tokens and the master password) is transmitted **unencrypted** across the internet. 
> 
> If you are only accessing this dashboard from your secure home network, this is fine. However, if you are accessing it publicly over the internet, it is **highly recommended** to set up a Reverse Proxy (like Nginx, Caddy, or Cloudflare Tunnels) in front of the dashboard to provide SSL encryption (HTTPS). If you use a reverse proxy, do **not** open port 3001 to the public internet; only allow your proxy to access it!

1. Open **Windows Defender Firewall with Advanced Security**.
2. Go to **Inbound Rules**.
3. Click **New Rule...** on the right side.
4. Select **Port** > Next.
5. Select **TCP** and enter Specific local port: `3001` > Next.
6. Select **Allow the connection** > Next.
7. Check Domain, Private, and Public > Next.
8. Name it `DCS Web Dashboard (3001)` and click **Finish**.

---

### 🎉 You are done!
You can now navigate to `http://YOUR_NEW_IP:3001` from any computer and log in!
