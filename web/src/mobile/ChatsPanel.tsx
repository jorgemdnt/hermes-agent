import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDownUp, Check, ChevronDown, FolderTree, Plus } from "lucide-react";
import { Avatar } from "./ui";
import { CHAT_SORTS, chatKeyOf, type ChatGroup, type ChatSort } from "./chat-list";
import type { Conversation } from "./conversations";
import { activityTime } from "./home-data";

interface Bots { label: (profile: string) => string; avatar: (profile: string) => string | undefined }

export function ChatsToolbar({ sort, onSort, grouped, onGrouped }: { sort: ChatSort; onSort: (sort: ChatSort) => void; grouped: boolean; onGrouped: (grouped: boolean) => void }) {
  return <div className="m-chats-toolbar">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="m-chats-tool" aria-label="Sort conversations" aria-pressed={sort !== "recent"}><ArrowDownUp size={16} aria-hidden="true" />{CHAT_SORTS.find(option => option.value === sort)?.label}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={document.querySelector<HTMLElement>(".m-shell")}>
        <DropdownMenu.Content className="m-dropdown" align="start" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.RadioGroup value={sort} onValueChange={value => onSort(value as ChatSort)}>
            {CHAT_SORTS.map(option => <DropdownMenu.RadioItem key={option.value} value={option.value}><Check size={16} aria-hidden="true" className="m-check" />{option.label}</DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <button type="button" className="m-chats-tool" aria-pressed={grouped} onClick={() => onGrouped(!grouped)}><FolderTree size={16} aria-hidden="true" />Group by project</button>
  </div>;
}

function ChatRow({ chat, bots, current, onOpen }: { chat: Conversation; bots: Bots; current: boolean; onOpen: (chat: Conversation) => void }) {
  const label = bots.label(chat.profile);
  return <button type="button" className="m-chat-row" data-unread={chat.unread || undefined} aria-current={current ? "page" : undefined} onClick={() => onOpen(chat)}>
    <span className="m-bot-copy">
      <span className="m-bot-heading">{chat.unread ? <i className="m-unread-dot" role="img" aria-label="Unread" /> : null}<strong title={chat.title}>{chat.title}</strong><span className="m-chat-row-trailing"><Avatar src={bots.avatar(chat.profile)} name={label} /><time>{activityTime(chat.lastActive)}</time></span></span>
      <span className="m-chat-row-meta"><small>{label}{chat.preview ? ` · ${chat.preview}` : ""}</small></span>
    </span>
  </button>;
}

export function ChatsPanel({ groups, grouped, collapsed, onToggleGroup, bots, currentKey, onOpen, onNewInProject, empty }: {
  groups: ChatGroup[]; grouped: boolean; collapsed: ReadonlySet<string>; onToggleGroup: (key: string) => void;
  bots: Bots; currentKey: string; onOpen: (chat: Conversation) => void; onNewInProject: (group: ChatGroup) => void; empty: ReactNode;
}) {
  if (!groups.some(group => group.chats.length)) return <div className="m-chats-empty">{empty}</div>;
  return <div className="m-chats">
    {groups.map(group => {
      const open = !grouped || !collapsed.has(group.key);
      return <section key={group.key} className="m-chat-group" data-grouped={grouped} aria-label={grouped ? group.label : "Conversations"}>
        {grouped && <div className="m-chat-group-label"><button type="button" className="m-chat-group-head" aria-expanded={open} onClick={() => onToggleGroup(group.key)}>
          <ChevronDown size={14} aria-hidden="true" /><span title={group.key}>{group.label}</span>
        </button><button type="button" className="m-chat-group-new" aria-label={`New conversation in ${group.label}`} onClick={() => onNewInProject(group)}><Plus size={16} aria-hidden="true" /></button></div>}
        {open && group.chats.map(chat => <ChatRow key={chatKeyOf(chat)} chat={chat} bots={bots} current={chatKeyOf(chat) === currentKey} onOpen={onOpen} />)}
      </section>;
    })}
  </div>;
}
