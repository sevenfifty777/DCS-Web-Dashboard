cd C:\Users\thierry\Documents\GitHub\DCS-gRPC\web-dashboard
npm install
npm run build

Remove-Item -Recurse -Force C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\static\*
Copy-Item -Path C:\Users\thierry\Documents\GitHub\DCS-gRPC\web-dashboard\out\* -Destination C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\static\ -Recurse

cargo build --release --manifest-path "C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\Cargo.toml"
