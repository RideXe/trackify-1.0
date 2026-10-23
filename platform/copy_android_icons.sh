#!/bin/bash
PACK_DIR="/Users/santhosh/Desktop/San/trackify-1.0/logo/extracted/vehicle_tracking_logo_pack"
RES_DIR="apps/mobile/android/app/src/main/res"

copy_icon() {
  local size=$1
  local folder=$2
  cp "$PACK_DIR/app-icons/icon-${size}x${size}.png" "$RES_DIR/$folder/ic_launcher.png"
  cp "$PACK_DIR/app-icons/icon-${size}x${size}.png" "$RES_DIR/$folder/ic_launcher_round.png"
  cp "$PACK_DIR/app-icons/icon-${size}x${size}.png" "$RES_DIR/$folder/ic_launcher_foreground.png"
}

copy_icon 48 "mipmap-mdpi"
copy_icon 72 "mipmap-hdpi"
copy_icon 96 "mipmap-xhdpi"
copy_icon 144 "mipmap-xxhdpi"
copy_icon 192 "mipmap-xxxhdpi"

# Replace general assets
cp "$PACK_DIR/master/vehicle-tracking-icon-1024.png" "apps/mobile/assets/icon.png"
cp "$PACK_DIR/master/vehicle-tracking-icon-1024.png" "apps/mobile/assets/adaptive-icon.png"

echo "Done replacing mobile icons"
