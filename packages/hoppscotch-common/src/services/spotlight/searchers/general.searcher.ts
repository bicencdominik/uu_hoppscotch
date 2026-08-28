import { Component, markRaw, reactive } from "vue"
import { invokeAction } from "~/helpers/actions"
import { getI18n } from "~/modules/i18n"
import { SpotlightSearcherResult, SpotlightService } from ".."
import {
  SearchResult,
  StaticSpotlightSearcherService,
} from "./base/static.searcher"

import IconLifeBuoy from "~icons/lucide/life-buoy"
import IconZap from "~icons/lucide/zap"
import { Container } from "dioc"

type Doc = {
  text: string | string[]
  alternates: string[]
  icon: object | Component
  action: () => void
}

/**
 *
 * This searcher is responsible for providing general related actions on the spotlight results.
 *
 * NOTE: Initializing this service registers it as a searcher with the Spotlight Service.
 */
export class GeneralSpotlightSearcherService extends StaticSpotlightSearcherService<Doc> {
  public static readonly ID = "GENERAL_SPOTLIGHT_SEARCHER_SERVICE"

  private t = getI18n()

  public readonly searcherID = "general"
  public searcherSectionTitle = this.t("spotlight.general.title")

  private readonly spotlight = this.bind(SpotlightService)

  // The docs, GitHub, Twitter, Discord and LinkedIn entries were removed for the
  // air-gapped build: they open hoppscotch.io properties that do not resolve, and
  // a command palette full of results that do nothing is worse than a short one.
  private documents: Record<string, Doc> = reactive({
    open_help: {
      text: this.t("spotlight.general.help_menu"),
      alternates: ["help", "hoppscotch"],
      icon: markRaw(IconLifeBuoy),
      action() {
        invokeAction("modals.support.toggle")
      },
    },
    open_keybindings: {
      text: this.t("spotlight.general.open_keybindings"),
      alternates: ["key", "shortcuts", "binding"],
      icon: markRaw(IconZap),
      action() {
        invokeAction("flyouts.keybinds.toggle")
      },
    },
  })

  // TODO: This is not recommended as of dioc > 3. Move to onServiceInit instead
  constructor(c: Container) {
    super(c, {
      searchFields: ["text", "alternates"],
      fieldWeights: {
        text: 2,
        alternates: 1,
      },
    })
  }

  override onServiceInit() {
    this.setDocuments(this.documents)
    this.spotlight.registerSearcher(this)
  }

  protected getSearcherResultForSearchResult(
    result: SearchResult<Doc>
  ): SpotlightSearcherResult {
    return {
      id: result.id,
      icon: result.doc.icon,
      text: { type: "text", text: result.doc.text },
      score: result.score,
    }
  }

  public onDocSelected(id: string): void {
    this.documents[id]?.action()
  }

  public addCustomEntries(docs: Record<string, Doc>) {
    this.documents = { ...this.documents, ...docs }
    this.setDocuments(this.documents)
  }
}
