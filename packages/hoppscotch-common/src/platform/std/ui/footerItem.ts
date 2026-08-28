import { HoppFooterMenuItem } from "../../ui"
import IconGift from "~icons/lucide/gift"
import IconActivity from "~icons/lucide/activity"

export const whatsNew: HoppFooterMenuItem = {
  id: "whats-new",
  text: (t) => t("app.whats_new"),
  icon: IconGift,
  action: {
    type: "link",
    href: "https://docs.hoppscotch.io/documentation/changelog",
  },
}

export const status: HoppFooterMenuItem = {
  id: "status",
  text: (t) => t("app.status"),
  icon: IconActivity,
  action: {
    type: "link",
    href: "https://status.hoppscotch.io",
  },
}

// Both of the above point at hoppscotch.io properties (a changelog and a status
// page for the hosted service) and are dead controls on an isolated network, so
// this build ships the menu empty. The items themselves are kept so a future
// upstream merge still has something to conflict against.
export const stdFooterItems: HoppFooterMenuItem[] = []
