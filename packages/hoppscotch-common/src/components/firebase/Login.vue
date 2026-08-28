<template>
  <HoppSmartModal
    dialog
    :title="`${t('auth.login_to_hoppscotch')}`"
    styles="sm:max-w-md"
    @close="hideModal"
  >
    <template #body>
      <template v-if="platform.auth.customLoginSelectorUI">
        <component :is="platform.auth.customLoginSelectorUI" />
      </template>

      <template v-else-if="isLoadingAllowedAuthProviders">
        <div class="flex justify-center">
          <HoppSmartSpinner />
        </div>
      </template>

      <template v-else>
        <div v-if="mode === 'sign-in'" class="flex flex-col space-y-2">
          <HoppSmartItem
            v-for="provider in allowedAuthProviders"
            :key="provider.id"
            :loading="provider.isLoading.value"
            :icon="provider.icon"
            :label="provider.label"
            @click="provider.action"
          />

          <hr
            v-if="
              additionalLoginItems.length > 0 && allowedAuthProviders.length
            "
          />

          <HoppSmartItem
            v-for="loginItem in additionalLoginItems"
            :key="loginItem.id"
            :icon="loginItem.icon"
            :label="loginItem.text(t)"
            @click="doAdditionalLoginItemClickAction(loginItem)"
          />
        </div>
        <form
          v-if="mode === 'email'"
          class="flex flex-col space-y-2"
          @submit.prevent="signInWithEmail"
        >
          <HoppSmartInput
            v-model="form.email"
            type="email"
            placeholder=" "
            :label="t('auth.email')"
            input-styles="floating-input"
          />

          <HoppButtonPrimary
            :loading="signingInWithEmail"
            type="submit"
            :label="`${t('auth.send_magic_link')}`"
          />
        </form>

        <form
          v-if="mode === 'password'"
          class="flex flex-col space-y-2"
          @submit.prevent="signInWithPassword"
        >
          <HoppSmartInput
            v-model="form.username"
            type="text"
            placeholder=" "
            autocomplete="username"
            :label="t('auth.username')"
            input-styles="floating-input"
          />

          <HoppSmartInput
            v-model="form.password"
            type="password"
            placeholder=" "
            autocomplete="current-password"
            :label="t('auth.password')"
            input-styles="floating-input"
          />

          <HoppButtonPrimary
            :loading="signingInWithPassword"
            type="submit"
            :label="`${t('auth.sign_in')}`"
          />
        </form>

        <div
          v-if="!allowedAuthProviders?.length && !additionalLoginItems.length"
          class="flex flex-col items-center text-center"
        >
          <p>{{ t("state.require_auth_provider") }}</p>
          <p>{{ t("state.configure_auth") }}</p>
          <div class="mt-5">
            <a
              href="https://docs.hoppscotch.io/documentation/self-host/getting-started"
            >
              <HoppButtonSecondary
                outline
                filled
                blank
                :icon="IconFileText"
                :label="t('state.self_host_docs')"
              />
            </a>
          </div>
        </div>
        <div v-if="mode === 'email-sent'" class="flex flex-col px-4">
          <div class="flex max-w-md flex-col items-center justify-center">
            <icon-lucide-inbox class="h-6 w-6 text-accent" />
            <h3 class="my-2 text-center text-lg">
              {{ t("auth.we_sent_magic_link") }}
            </h3>
            <p class="text-center">
              {{
                t("auth.we_sent_magic_link_description", { email: form.email })
              }}
            </p>
          </div>
        </div>
      </template>
    </template>
    <template #footer>
      <div
        v-if="mode === 'sign-in' && tosLink && privacyPolicyLink"
        class="text-tiny text-secondaryLight"
      >
        By signing in, you are agreeing to our
        <HoppSmartAnchor
          class="link"
          :to="tosLink"
          blank
          label="Terms of Service"
        />
        and
        <HoppSmartAnchor
          class="link"
          :to="privacyPolicyLink"
          blank
          label="Privacy Policy"
        />
      </div>
      <div v-if="mode === 'email'">
        <HoppButtonSecondary
          :label="t('auth.all_sign_in_options')"
          :icon="IconArrowLeft"
          class="!p-0"
          @click="mode = 'sign-in'"
        />
      </div>
      <div v-if="mode === 'password' && hasMultipleSignInOptions()">
        <HoppButtonSecondary
          :label="t('auth.all_sign_in_options')"
          :icon="IconArrowLeft"
          class="!p-0"
          @click="mode = 'sign-in'"
        />
      </div>
      <div
        v-if="mode === 'email-sent'"
        class="flex flex-1 justify-between text-secondaryLight"
      >
        <HoppSmartAnchor
          class="link"
          :label="t('auth.re_enter_email')"
          :icon="IconArrowLeft"
          @click="mode = 'email'"
        />
        <HoppSmartAnchor
          class="link"
          :label="`${t('action.dismiss')}`"
          @click="hideModal"
        />
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { Ref, onMounted, reactive, ref } from "vue"

import { useI18n } from "@composables/i18n"
import { useStreamSubscriber } from "@composables/stream"
import { useToast } from "@composables/toast"

import { platform } from "~/platform"

import IconEmail from "~icons/auth/email"
import IconGithub from "~icons/auth/github"
import IconGoogle from "~icons/auth/google"
import IconMicrosoft from "~icons/auth/microsoft"
import IconLock from "~icons/lucide/lock"
import IconArrowLeft from "~icons/lucide/arrow-left"
import IconFileText from "~icons/lucide/file-text"

import { useService } from "dioc/vue"
import { LoginItemDef } from "~/platform/auth"
import { PersistenceService } from "~/services/persistence"

import * as E from "fp-ts/Either"

const emit = defineEmits<{
  (e: "hide-modal"): void
}>()

const { subscribeToStream } = useStreamSubscriber()
const t = useI18n()
const toast = useToast()

const persistenceService = useService(PersistenceService)

// Reactive because the password field is cleared programmatically after a failed
// sign-in; a plain object would update the variable but never the input.
const form = reactive({
  email: "",
  username: "",
  password: "",
})

const isLoadingAllowedAuthProviders = ref(true)

const signingInWithGoogle = ref(false)
const signingInWithGitHub = ref(false)
const signingInWithMicrosoft = ref(false)
const signingInWithEmail = ref(false)
const signingInWithPassword = ref(false)
const mode = ref("sign-in")

const tosLink = import.meta.env.VITE_APP_TOS_LINK
const privacyPolicyLink = import.meta.env.VITE_APP_PRIVACY_POLICY_LINK

type AuthProviderItem = {
  id: string
  icon: typeof IconGithub
  label: string
  action: (...args: any[]) => any
  isLoading: Ref<boolean>
}

let allowedAuthProviders: AuthProviderItem[] = []
const additionalLoginItems: LoginItemDef[] = []

const doAdditionalLoginItemClickAction = async (item: LoginItemDef) => {
  await item.onClick()
  emit("hide-modal")
}

onMounted(async () => {
  const currentUser$ = platform.auth.getCurrentUserStream()

  subscribeToStream(currentUser$, (user) => {
    if (user) hideModal()
  })

  const res = await platform.auth.getAllowedAuthProviders()

  if (E.isLeft(res)) {
    toast.error(`${t("error.authproviders_load_error")}`)
    isLoadingAllowedAuthProviders.value = false
    return
  }

  // setup the normal auth providers
  const enabledAuthProviders = authProvidersAvailable.filter((provider) =>
    res.right.includes(provider.id)
  )
  allowedAuthProviders = enabledAuthProviders

  // setup the additional login items
  platform.auth.additionalLoginItems?.forEach((item) => {
    if (res.right.includes(item.id)) {
      additionalLoginItems.push(item)
    }

    // since the BE send the OIDC auth providers as OIDC:providerName,
    // we need to split the string and use the providerName as the text
    if (item.id === "OIDC") {
      res.right
        .filter((provider) => provider.startsWith("OIDC"))
        .forEach((provider) => {
          const OIDCName = provider.split(":")[1]
          const loginItemText = OIDCName
            ? () =>
                t("auth.continue_with_auth_provider", {
                  provider: OIDCName,
                })
            : item.text

          const OIDCLoginItem = {
            ...item,
            text: loginItemText,
          }
          additionalLoginItems.push(OIDCLoginItem)
        })
    }
  })

  // When password is the only way in, open straight into the form. A provider
  // picker listing a single item reads as a bug, and it costs an extra click on
  // every single login.
  if (
    allowedAuthProviders.length === 1 &&
    allowedAuthProviders[0].id === "PASSWORD" &&
    additionalLoginItems.length === 0
  ) {
    mode.value = "password"
  }

  isLoadingAllowedAuthProviders.value = false
})

// True when the picker has more than one entry, i.e. there is somewhere to go
// back to. Drives the "All sign in options" link in the password form's footer.
const hasMultipleSignInOptions = () =>
  allowedAuthProviders.length + additionalLoginItems.length > 1

const showLoginSuccess = () => {
  toast.success(`${t("auth.login_success")}`)
}

const signInWithGoogle = async () => {
  signingInWithGoogle.value = true

  try {
    await platform.auth.signInUserWithGoogle()
  } catch (e) {
    console.error(e)
    /*
        A auth/account-exists-with-different-credential Firebase error wont happen between Google and any other providers
        Seems Google account overwrites accounts of other providers https://github.com/firebase/firebase-android-sdk/issues/25
        */
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithGoogle.value = false
}

const signInWithGithub = async () => {
  signingInWithGitHub.value = true

  const result = await platform.auth.signInUserWithGithub()

  if (!result) {
    signingInWithGitHub.value = false
    return
  }

  if (result.type === "success") {
    // this.showLoginSuccess()
  } else if (result.type === "account-exists-with-different-cred") {
    toast.info(`${t("auth.account_exists")}`, {
      duration: 0,
      closeOnSwipe: false,
      action: {
        text: `${t("action.yes")}`,
        onClick: async (_, toastObject) => {
          await result.link()
          showLoginSuccess()

          toastObject.goAway(0)
        },
      },
    })
  } else {
    console.log("error logging into github", result.err)
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithGitHub.value = false
}

const signInWithMicrosoft = async () => {
  signingInWithMicrosoft.value = true

  try {
    await platform.auth.signInUserWithMicrosoft()
    // this.showLoginSuccess()
  } catch (e) {
    console.error(e)
    /*
        A auth/account-exists-with-different-credential Firebase error wont happen between MS with Google or Github
        If a Github account exists and user then logs in with MS email we get a "Something went wrong toast" and console errors and MS replaces GH as only provider.
        The error messages are as follows:
            FirebaseError: Firebase: Error (auth/popup-closed-by-user).
            @firebase/auth: Auth (9.6.11): INTERNAL ASSERTION FAILED: Pending promise was never set
        They may be related to https://github.com/firebase/firebaseui-web/issues/947
        */
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithMicrosoft.value = false
}

const signInWithEmail = async () => {
  signingInWithEmail.value = true

  await platform.auth
    .signInWithEmail(form.email)
    .then(async () => {
      mode.value = "email-sent"
      await persistenceService.setLocalConfig("emailForSignIn", form.email)
    })
    .catch((e) => {
      console.error(e)
      toast.error(e.message)
      signingInWithEmail.value = false
    })
    .finally(() => {
      signingInWithEmail.value = false
    })
}

const signInWithPassword = async () => {
  if (!platform.auth.signInWithPassword) return

  signingInWithPassword.value = true

  try {
    const res = await platform.auth.signInWithPassword(
      form.username,
      form.password
    )

    if (E.isLeft(res)) {
      // Clear only the password: making the user retype a correct username after
      // a typo in the password is pure friction.
      form.password = ""
      toast.error(passwordErrorMessage(res.left))
    }

    // On success the currentUser$ subscription set up in onMounted closes the
    // modal for us, exactly as it does for every other sign-in method.
  } catch (e) {
    // The platform method can still throw despite returning an Either -- it makes
    // a second request after the credentials are accepted. Without this the
    // submit button would spin forever with nothing shown to the user.
    console.error(e)
    form.password = ""
    toast.error(`${t("error.something_went_wrong")}`)
  } finally {
    signingInWithPassword.value = false
  }
}

/**
 * Map a backend error code to something worth showing a person.
 *
 * Note that the backend returns one code for both "no such user" and "wrong
 * password" on purpose -- do not add separate messages for them here.
 */
const passwordErrorMessage = (error: string) => {
  switch (error) {
    case "auth/invalid_credentials":
      return t("auth.invalid_credentials")
    case "TOO_MANY_ATTEMPTS":
      return t("auth.too_many_attempts")
    case "auth/provider_not_specified":
      return t("auth.password_provider_disabled")
    default:
      return t("error.something_went_wrong")
  }
}

const authProvidersAvailable: AuthProviderItem[] = [
  {
    id: "GITHUB",
    icon: IconGithub,
    label: t("auth.continue_with_github"),
    action: signInWithGithub,
    isLoading: signingInWithGitHub,
  },
  // the authprovider either send github or github:enterprise and both are handled by the same route
  {
    id: "GITHUB:ENTERPRISE",
    icon: IconGithub,
    label: t("auth.continue_with_github_enterprise"),
    action: signInWithGithub,
    isLoading: signingInWithGitHub,
  },
  {
    id: "GOOGLE",
    icon: IconGoogle,
    label: t("auth.continue_with_google"),
    action: signInWithGoogle,
    isLoading: signingInWithGoogle,
  },
  {
    id: "MICROSOFT",
    icon: IconMicrosoft,
    label: t("auth.continue_with_microsoft"),
    action: signInWithMicrosoft,
    isLoading: signingInWithMicrosoft,
  },
  {
    id: "EMAIL",
    icon: IconEmail,
    label: t("auth.continue_with_email"),
    action: () => {
      mode.value = "email"
    },
    isLoading: signingInWithEmail,
  },
  {
    id: "PASSWORD",
    icon: IconLock,
    label: t("auth.continue_with_password"),
    action: () => {
      mode.value = "password"
    },
    isLoading: signingInWithPassword,
  },
]

const hideModal = () => {
  mode.value = "sign-in"
  toast.clear()

  emit("hide-modal")
}
</script>
