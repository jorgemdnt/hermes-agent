import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LayoutGrid, LogOut, Monitor, Settings2 } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "./ui";

export function ProfileDropdown({ open, onOpenChange, showScreen, container, name, picture, onSignOut, signingOut, desktop = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; showScreen: boolean; container?: HTMLElement | null;
  name: string; picture: string; onSignOut: () => void; signingOut: boolean; desktop?: boolean;
}) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger className="m-icon-button m-profile-button" aria-label="Profile menu"><Avatar src={picture} name={name} />{desktop && <span className="m-profile-name">{name}</span>}</DropdownMenu.Trigger>
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content className="m-dropdown" align="start" side={desktop ? "top" : "bottom"} sideOffset={8} collisionPadding={12}>
        <DropdownMenu.Label className="m-dropdown-label">{name}</DropdownMenu.Label>
        <DropdownMenu.Separator className="m-dropdown-separator" />
        <DropdownMenu.Item asChild><Link to="/m/board"><LayoutGrid size={17} aria-hidden="true" />Board</Link></DropdownMenu.Item>
        {showScreen && <DropdownMenu.Item asChild><Link to="/m/screen/samwise"><Monitor size={17} aria-hidden="true" />Screen</Link></DropdownMenu.Item>}
        <DropdownMenu.Item asChild><Link to="/m/settings"><Settings2 size={17} aria-hidden="true" />Settings</Link></DropdownMenu.Item>
        <DropdownMenu.Separator className="m-dropdown-separator" />
        <DropdownMenu.Item disabled={signingOut} onSelect={onSignOut}><LogOut size={17} aria-hidden="true" />Sign out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
