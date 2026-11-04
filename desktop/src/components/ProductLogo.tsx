import icon from "../../assets/branding/app-icon.png";
import navigationWordmark from "../../assets/branding/navigation-wordmark.svg";

export function ProductLogo() {
  return (
    <span className="product-logo" role="img" aria-label="open-fitness">
      <img src={icon} alt="" width="32" height="32" />
      <img src={navigationWordmark} alt="" width="116" height="18" />
    </span>
  );
}
