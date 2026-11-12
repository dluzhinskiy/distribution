// Public skin registry: identity, assets and optional control variants.
export const defaultSkin = "blue";
export const defaultIcons = "/skins/icons.svg";
const blueLogo = "/apple_logo_blue_512.png";
const grayLogo = "/logo-gray-flat.png";

export const skins = {
  blue: { id: "blue", label: "Голубой", classes: ["theme-blue"], logo: blueLogo },
  red: { id: "red", label: "Красный", classes: ["theme-red"], logo: "/apple_logo_red_512.png", authLogo: blueLogo },
  gray: { id: "gray", label: "Серый", menuLabel: "Серый рельефный", classes: ["theme-gray"], logo: grayLogo, customControls: true, alternate: "gray-dark" },
  "gray-dark": { id: "gray-dark", label: "Серый · тёмный", classes: ["theme-gray", "theme-gray-dark"], logo: grayLogo, customControls: true, alternate: "gray", menuId: "gray", dark: true },
};

export function getSkin(id) {
  return Object.hasOwn(skins, id) ? skins[id] : skins[defaultSkin];
}

const workloadIcons = {
  "судебное": "workload-1",
  "административное": "workload-2",
  "претензия": "workload-3",
  "заключение": "workload-4",
  "уголовное": "workload-5",
  "банкротное": "workload-6"
};

export function workloadSkinIcon(type) {
  const key = String(type).toLowerCase();
  return Object.hasOwn(workloadIcons, key) ? workloadIcons[key] : workloadIcons["заключение"];
}
