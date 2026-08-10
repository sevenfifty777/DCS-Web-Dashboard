cd C:\Users\thierry\Documents\GitHub\sevenfifty777\DCS-Web-Dashboard\web-dashboard
npm install
npm run build

Remove-Item -Recurse -Force C:\Users\thierry\Documents\GitHub\sevenfifty777\DCS-Web-Dashboard\rust-web-dashboard\static\*
Copy-Item -Path C:\Users\thierry\Documents\GitHub\sevenfifty777\DCS-Web-Dashboard\web-dashboard\out\* -Destination C:\Users\thierry\Documents\GitHub\sevenfifty777\DCS-Web-Dashboard\rust-web-dashboard\static\ -Recurse

cargo build --release --manifest-path "C:\Users\thierry\Documents\GitHub\sevenfifty777\DCS-Web-Dashboard\rust-web-dashboard\Cargo.toml"
