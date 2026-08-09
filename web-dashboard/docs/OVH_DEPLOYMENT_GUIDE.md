# 🚀 DCS Web Dashboard - OVH Production Deployment Guide

This guide outlines the streamlined steps for deploying the Caddy Reverse Proxy and SSL encryption on your production **OVH (SoYouStart) Windows Server**. 

Unlike a home network, the OVH server is connected directly to the internet, so you can completely bypass complex router port-forwarding!

---

## 1. DNS Configuration (AWS Route 53)
Because the OVH server is directly exposed to the internet, you only need to point your domain directly to it.
- Log into **AWS Route 53**.
- Find your existing A Record (e.g., `dcs.ttsandbox.click`), edit it, and change the `Value` to the **Public IP Address of your OVH Server**.
- *(Optional)* If you plan to secure your other Node.js app as well, create a second A Record (e.g., `app.ttsandbox.click`) and point it to the exact same OVH IP address.

---

## 2. Server Firewall Configuration
Log into your OVH Windows Server and open the necessary ports in the Windows Defender Firewall.
- **Open Port 80 & 443** (Required for Caddy and Let's Encrypt SSL Verification)
- **Close Port 3001** (Highly recommended: This prevents users from bypassing your SSL encryption and accessing the raw HTTP dashboard)

**Fastest Method:** Open an Administrator PowerShell and run this command:
```powershell
New-NetFirewallRule -DisplayName "Caddy Web Server (HTTP/HTTPS)" -Direction Inbound -LocalPort 80,443 -Protocol TCP -Action Allow
```

---

## 3. Install Caddy
- Download the Windows executable for [Caddy](https://caddyserver.com/).
- Place it in a permanent folder on the OVH Server, for example: `C:\Caddy\caddy.exe`.

---

## 4. Configure the Caddyfile
- Create a simple text file named `Caddyfile` (make sure Windows doesn't secretly add a `.txt` extension!) in the exact same folder as the `.exe`.
- Add your routing configuration:

```text
dcs.ttsandbox.click {
    reverse_proxy localhost:3001
}

# (Optional: Add your second app here!)
# app.ttsandbox.click {
#     reverse_proxy localhost:3000
# }
```

---

## 5. Update Discord & Dashboard Config
You must ensure the dashboard and Discord know its new production domain name.
1. Open `.env.local` on the OVH server and update the variables:
   ```ini
   NEXT_PUBLIC_APP_URL=https://dcs.ttsandbox.click
   MOBILE_API_KEY="my_super_secret_android_key_123"
   ```
2. **CRITICAL:** Rebuild the dashboard! Open a command prompt in the dashboard folder and run `npm run build`.
3. Restart the dashboard service in `services.msc`.
4. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and update your OAuth2 callback URL to:
   `https://dcs.ttsandbox.click/api/auth/callback`

---

## 6. Install Caddy as a Windows Service
Just like you did with the dashboard, use NSSM to run Caddy forever in the background.
1. Open an Administrator Command Prompt.
2. Run `nssm install Caddy`
3. Fill out the UI:
   - **Path:** `C:\Caddy\caddy.exe`
   - **Arguments:** `run --config C:\Caddy\Caddyfile`
4. Click **Install Service**, then start the "Caddy" service from `services.msc`.

---

## ✅ Final Verification
1. Open a browser and navigate to `https://dcs.ttsandbox.click`.
2. Verify the page loads securely with a padlock icon.
3. Log in with Discord to verify the OAuth callback works seamlessly in production.
