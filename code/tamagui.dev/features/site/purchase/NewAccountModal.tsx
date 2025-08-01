import { LogOut, Search, X } from '@tamagui/lucide-icons'
import { animationsCSS } from '@tamagui/tamagui-dev-config'
import { createStore, createUseStore } from '@tamagui/use-store'
import type {
  APIGuildMember,
  RESTGetAPIGuildMembersSearchResult,
} from 'discord-api-types/v10'
import { router } from 'one'
import { useEffect, useMemo, useState } from 'react'
import useSWR, { mutate } from 'swr'
import useSWRMutation from 'swr/mutation'
import {
  Avatar,
  Button,
  Configuration,
  debounce,
  Dialog,
  Fieldset,
  Form,
  H3,
  H4,
  Input,
  Label,
  Paragraph,
  ScrollView,
  Separator,
  Sheet,
  Spinner,
  Tabs,
  View,
  XStack,
  YStack,
} from 'tamagui'
import type { UserContextType } from '~/features/auth/types'
import { useSupabaseClient } from '~/features/auth/useSupabaseClient'
import { CURRENT_PRODUCTS } from '~/features/stripe/products'
import { getDefaultAvatarImage } from '~/features/user/getDefaultAvatarImage'
import { useUser } from '~/features/user/useUser'
import { useClipboard } from '~/hooks/useClipboard'
import { Pricing, ProductName, SubscriptionStatus } from '~/shared/types/subscription'
import { Link } from '../../../components/Link'
import { addTeamMemberModal, AddTeamMemberModalComponent } from './AddTeamMemberModal'
import { FaqTabContent } from './NewPurchaseModal'
import { paymentModal } from './StripePaymentModal'
import { useProducts } from './useProducts'
import {
  useInviteTeamMember,
  useRemoveTeamMember,
  useTeamSeats,
  type TeamMember,
  type TeamSubscription,
} from './useTeamSeats'

class AccountModal {
  show = false
}

type Subscription = NonNullable<UserContextType['subscriptions']>[number]

export const accountModal = createStore(AccountModal)
export const useAccountModal = createUseStore(AccountModal)

type TabName = 'plan' | 'upgrade' | 'manage' | 'team' | 'faq'

export const NewAccountModal = () => {
  const store = useAccountModal()

  return (
    <>
      <Dialog
        modal
        open={store.show}
        onOpenChange={(val) => {
          store.show = val
        }}
      >
        <Dialog.Adapt when="maxMd">
          <Sheet modal dismissOnSnapToBottom animation="medium">
            <Sheet.Frame bg="$background" padding={0} gap="$4">
              <Sheet.ScrollView>
                <Dialog.Adapt.Contents />
              </Sheet.ScrollView>
            </Sheet.Frame>
            <Sheet.Overlay
              animation="lazy"
              bg="$shadow6"
              opacity={1}
              enterStyle={{ opacity: 0 }}
              exitStyle={{ opacity: 0 }}
            />
          </Sheet>
        </Dialog.Adapt>

        <Dialog.Portal>
          <Configuration animationDriver={animationsCSS}>
            <Dialog.Overlay
              key="overlay"
              animation="medium"
              bg="$shadow3"
              backdropFilter="blur(20px)"
              enterStyle={{ opacity: 0 }}
              exitStyle={{ opacity: 0 }}
            />
          </Configuration>

          <Dialog.Content
            bordered
            elevate
            key="content"
            animation={[
              'quick',
              {
                opacity: {
                  overshootClamping: true,
                },
              },
            ]}
            enterStyle={{ x: 0, y: -5, opacity: 0, scale: 0.95 }}
            exitStyle={{ x: 0, y: 5, opacity: 0, scale: 0.95 }}
            width="90%"
            maw={800}
            p={0}
            br="$4"
            ov="hidden"
            height="85%"
            maxHeight="calc(min(85vh, 800px))"
            minHeight={500}
          >
            <AccountView />

            <Dialog.Close asChild>
              <Button
                position="absolute"
                top="$3"
                right="$3"
                size="$3"
                circular
                icon={X}
              />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      <AddTeamMemberModalComponent />
    </>
  )
}

export const AccountView = () => {
  const { isLoading, data } = useUser()

  const [currentTab, setCurrentTab] = useState<TabName>('plan')

  if (isLoading || !data) {
    return null
  }

  const { subscriptions } = data

  // Get active subscriptions
  const filteredSubscriptions = subscriptions?.filter(
    (sub) =>
      (sub.status === SubscriptionStatus.Active ||
        sub.status === SubscriptionStatus.Trialing) &&
      sub.subscription_items?.some(
        (item) =>
          item.price?.product?.id &&
          CURRENT_PRODUCTS.includes(item.price.product.id as any)
      )
  )

  // Deduplicate by product ID, keeping the one with latest current_period_end
  const activeSubscriptions = filteredSubscriptions?.reduce((acc, sub) => {
    const productIds =
      sub.subscription_items?.map((item) => item.price?.product?.id).filter(Boolean) || []

    productIds.forEach((productId) => {
      const existing = acc.find((existingSub) =>
        existingSub.subscription_items?.some(
          (item) => item.price?.product?.id === productId
        )
      )

      if (!existing) {
        acc.push(sub)
      } else {
        // Replace with the one that has later current_period_end
        if (new Date(sub.current_period_end) > new Date(existing.current_period_end)) {
          const index = acc.indexOf(existing)
          acc[index] = sub
        }
      }
    })

    return acc
  }, [] as Subscription[])

  const proTeamSubscription = activeSubscriptions?.find((sub) =>
    sub.subscription_items?.some(
      (item) => item.price?.product?.name === ProductName.TamaguiProTeamSeats
    )
  ) as Subscription

  const haveTeamSeats = !!proTeamSubscription?.id

  // Conditionally fetch team data only when team seats are available
  const {
    data: teamData,
    error: teamError,
    isLoading: isTeamLoading,
  } = useTeamSeats(haveTeamSeats)

  // Find Pro subscription
  const proSubscription = haveTeamSeats
    ? proTeamSubscription
    : (activeSubscriptions?.find((sub) =>
        sub.subscription_items?.some(
          (item) => item.price?.product?.name === ProductName.TamaguiPro
        )
      ) as Subscription)

  // Find ALL support-related subscriptions (Chat and/or Support tiers)
  const supportSubscriptions = activeSubscriptions
    ?.filter((sub) =>
      sub.subscription_items?.some(
        (item) =>
          item.price?.product?.name === ProductName.TamaguiSupport ||
          item.price?.product?.name === ProductName.TamaguiChat
      )
    )
    .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())

  // Use the first support subscription for Discord operations (oldest first)
  // But will calculate total seats from ALL user support subscriptions
  // TODO: Consolidate Chat + Support tier into single subscription to avoid complexity
  // - When user has Chat subscription and purchases Support tier, upgrade the existing Chat subscription instead of creating new one
  // - This eliminates multiple subscriptions with same functionality and simplifies seat calculation
  // - Update upgrade-subscription API to check for existing support subscriptions and modify them instead of creating new ones
  // - Benefits: Single Discord channel, unified billing, easier management, no need for complex multi-subscription logic
  // WARNING: This is a temporary solution to avoid the complexity of having multiple subscriptions with the same functionality.
  const supportSubscription = supportSubscriptions?.[0]

  const user = data.user
  const isTeamAdmin = haveTeamSeats && user?.id === proTeamSubscription?.user_id
  const isTeamMember = haveTeamSeats && !isTeamAdmin

  const renderTabs = () => {
    switch (currentTab) {
      case 'plan':
        return (
          <PlanTab
            subscription={proSubscription!}
            supportSubscription={supportSubscription!}
            setCurrentTab={setCurrentTab}
            isTeamMember={!!isTeamMember}
          />
        )

      case 'upgrade':
        return <UpgradeTab />

      case 'manage':
        return (
          <ManageTab
            subscriptions={activeSubscriptions!}
            isTeamMember={!!isTeamMember}
            teamData={teamData}
            isTeamLoading={isTeamLoading}
          />
        )

      case 'team':
        return (
          <TeamTab
            teamData={teamData}
            isTeamLoading={isTeamLoading}
            teamError={teamError}
          />
        )

      case 'faq':
        return <FaqTabContent />

      default:
        return null
    }
  }

  return (
    <YStack f={1}>
      <Tabs
        flex={1}
        value={currentTab}
        onValueChange={(val: any) => setCurrentTab(val)}
        orientation="horizontal"
        flexDirection="column"
        size="$6"
      >
        <Tabs.List disablePassBorderRadius>
          <YStack width={'33.3333%'} f={1}>
            <Tab isActive={currentTab === 'plan'} value="plan">
              Plan
            </Tab>
          </YStack>
          {!isTeamMember ? (
            <YStack width={'33.3333%'} f={1}>
              <Tab isActive={currentTab === 'upgrade'} value="upgrade">
                Upgrade
              </Tab>
            </YStack>
          ) : null}
          <YStack width={'33.3333%'} f={1}>
            <Tab isActive={currentTab === 'manage'} value="manage">
              Manage
            </Tab>
          </YStack>
          {isTeamAdmin && (
            <YStack width={'33.3333%'} f={1}>
              <Tab isActive={currentTab === 'team'} value="team">
                Team
              </Tab>
            </YStack>
          )}
          <YStack width={'33.3333%'} f={1}>
            <Tab isActive={currentTab === 'faq'} value="faq">
              FAQ
            </Tab>
          </YStack>
        </Tabs.List>

        <YStack overflow="hidden" f={1}>
          <ScrollView>
            <YStack p="$6">{renderTabs()}</YStack>
          </ScrollView>
        </YStack>
      </Tabs>

      <Separator />

      <AccountHeader />
    </YStack>
  )
}

const AccountHeader = () => {
  const { isLoading, data } = useUser()

  if (isLoading || !data) {
    return null
  }
  const { userDetails, user } = data

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      if (response.ok) {
        window.location.href = '/'
      }
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  return (
    <XStack gap="$4" p="$5" pb="$8">
      <Avatar circular size="$5">
        <Avatar.Image
          source={{
            width: 50,
            height: 50,
            uri:
              userDetails?.avatar_url ??
              getDefaultAvatarImage(userDetails?.full_name ?? user?.email ?? 'User'),
          }}
        />
      </Avatar>

      <YStack gap="$3" ai="flex-start" jc="center" f={1}>
        <XStack jc="space-between" space ai="center">
          <YStack f={1}>
            <H3
              mt={-5}
              style={{
                wordBreak: 'break-word',
              }}
            >
              {userDetails?.full_name}
            </H3>
            <Paragraph theme="alt1">{user?.email}</Paragraph>
          </YStack>
        </XStack>
      </YStack>

      <Button
        onPress={handleLogout}
        icon={<LogOut />}
        size="$2"
        alignSelf="flex-end"
        accessibilityLabel="Logout"
      >
        Logout
      </Button>
    </XStack>
  )
}

const Tab = ({
  children,
  isActive,
  ...props
}: {
  children: React.ReactNode
  isActive: boolean
  value: string
}) => {
  return (
    <Tabs.Tab
      unstyled
      ai="center"
      jc="center"
      ov="hidden"
      py="$1"
      bg="$color1"
      height={60}
      disableActiveTheme
      bbw={1}
      bbc="transparent"
      {...(!isActive && {
        bg: '$color2',
      })}
      {...props}
      value={props.value}
    >
      <YStack
        fullscreen
        pe="none"
        zi={-1}
        {...(isActive && {
          bg: '$color3',
        })}
        {...(!isActive && {
          bg: '$color1',
          o: 0.25,
          '$group-takeoutBody-hover': {
            o: 0.33,
          },
        })}
      />
      <Paragraph
        ff="$mono"
        size="$7"
        color={isActive ? '$color12' : '$color10'}
        fow={isActive ? 'bold' : 'normal'}
      >
        {children}
      </Paragraph>
    </Tabs.Tab>
  )
}

const ServiceCard = ({
  title,
  description,
  actionLabel,
  onAction,
  secondAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  secondAction?: null | {
    label: string
    onPress: () => void
  }
}) => {
  return (
    <YStack
      borderWidth={1}
      borderColor="$color3"
      borderRadius="$6"
      p="$4"
      gap="$2"
      width={300}
      flex={1}
    >
      <H3 fontFamily="$mono" size="$6">
        {title}
      </H3>
      <Paragraph theme="alt1">{description}</Paragraph>

      <XStack gap="$3">
        <Button
          br="$10"
          als="flex-end"
          mt="$4"
          size="$3"
          theme="accent"
          onPress={onAction}
        >
          {actionLabel}
        </Button>

        {!!secondAction && (
          <Button
            br="$10"
            als="flex-end"
            mt="$4"
            size="$3"
            theme="accent"
            onPress={secondAction.onPress}
          >
            {secondAction.label}
          </Button>
        )}
      </XStack>
    </YStack>
  )
}

const DiscordAccessDialog = ({
  subscription,
  onClose,
  isTeamMember,
  apiType,
}: {
  subscription: Subscription
  onClose: () => void
  isTeamMember: boolean
  apiType: 'channel' | 'support'
}) => {
  return (
    <Dialog modal open onOpenChange={onClose}>
      <Dialog.Portal zIndex={999999}>
        <Dialog.Overlay
          key="overlay"
          animation="medium"
          opacity={0.5}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          bordered
          elevate
          key="content"
          animation="quick"
          w="90%"
          maw={600}
          p="$6"
        >
          <DiscordPanel
            subscription={subscription}
            apiType={apiType}
            isTeamMember={isTeamMember}
          />
          <Dialog.Close asChild>
            <Button position="absolute" top="$2" right="$2" size="$2" circular icon={X} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

const DiscordPanel = ({
  subscription,
  apiType,
  isTeamMember,
}: {
  subscription?: Subscription
  apiType: 'channel' | 'support'
  isTeamMember: boolean
}) => {
  const hasSupportAccess = () => {
    const supportItems = subscription?.subscription_items?.filter((item) => {
      return (
        item.price?.product?.name === ProductName.TamaguiSupport ||
        item.price?.product?.name === ProductName.TamaguiChat
      )
    })

    if (!supportItems || supportItems.length === 0) {
      return { hasAccess: false, hasChat: false, hasTier: false }
    }

    // Check for chat support
    const chatItem = supportItems.find(
      (item) => item.price?.product?.name === ProductName.TamaguiChat
    )
    const hasChat = !!chatItem

    // Check for support tier
    const tierItem = supportItems.find(
      (item) => item.price?.product?.name === ProductName.TamaguiSupport
    )

    let hasTier = false

    if (tierItem) {
      hasTier = true
    }

    return {
      hasAccess: hasChat || hasTier,
      hasChat,
      hasTier,
    }
  }

  const {
    data: groupInfoData,
    error: groupInfoError,
    isLoading,
  } = useSWR<any>(
    subscription?.id
      ? `/api/discord/${apiType}?${new URLSearchParams({ subscription_id: subscription.id })}`
      : null,
    (url) =>
      fetch(url, { headers: { 'Content-Type': 'application/json' } }).then((res) =>
        res.json()
      ),
    { revalidateOnFocus: false, revalidateOnReconnect: false, errorRetryCount: 0 }
  )
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState(draftQuery)
  const searchSwr = useSWR<RESTGetAPIGuildMembersSearchResult>(
    query
      ? `/api/discord/search-member?${new URLSearchParams({ query }).toString()}`
      : null,
    (url) =>
      fetch(url, { headers: { 'Content-Type': 'application/json' } }).then((res) =>
        res.json()
      )
  )

  const resetChannelMutation = useSWRMutation(
    subscription?.id ? [`/api/discord/${apiType}`, 'DELETE', subscription.id] : null,
    (url) =>
      fetch(`/api/discord/${apiType}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: subscription?.id,
        }),
      }).then((res) => res.json()),
    {
      onSuccess: async () => {
        if (subscription?.id) {
          await mutate(
            `/api/discord/${apiType}?${new URLSearchParams({
              subscription_id: subscription.id,
            })}`
          )
        }
        setDraftQuery('')
        setQuery('')
      },
    }
  )

  const handleSearch = async () => {
    setQuery(draftQuery)
  }

  const SearchForm = () => (
    <>
      <Form onSubmit={handleSearch} gap="$2" flexDirection="row" ai="flex-end">
        <Fieldset>
          <Label size="$3" theme="alt1" htmlFor="discord-username">
            Username / Nickname
          </Label>
          <Input
            miw={200}
            placeholder="Your username..."
            id="discord-username"
            value={draftQuery}
            onChangeText={setDraftQuery}
          />
        </Fieldset>

        <Form.Trigger>
          <Button icon={Search}>Search</Button>
        </Form.Trigger>
      </Form>

      <XStack tag="article">
        <Paragraph size="$3" theme="alt1">
          Note: You must{' '}
          <Link target="_blank" href="https://discord.gg/4qh6tdcVDa">
            join the Discord server
          </Link>{' '}
          first so we can find your username.
        </Paragraph>
      </XStack>

      {Array.isArray(searchSwr.data) && searchSwr.data.length === 0 ? (
        <Paragraph size="$3" theme="alt1">
          No users found
        </Paragraph>
      ) : (
        searchSwr.data?.map((member) => (
          <DiscordMember
            key={member.user?.id}
            member={member}
            subscriptionId={subscription?.id || ''}
            apiType={apiType}
          />
        ))
      )}
    </>
  )

  const DiscordAccessHeader = () => {
    // Show seats count when:
    // - User is in General Channel (always show)
    // - User is in Support Channel AND has any support access
    const supportAccess = hasSupportAccess()
    const showSeats =
      apiType === 'channel' || (apiType === 'support' && supportAccess.hasAccess)

    // Show reset button when:
    // - User is not a team member (only team owner or normal PRO user can reset)
    // - There are occupied seats to reset
    // - The seats are visible (using same logic as showSeats)
    const showResetButton =
      !isTeamMember && groupInfoData?.currentlyOccupiedSeats > 0 && showSeats

    const title = apiType === 'channel' ? 'Discord Access' : 'Private Support Access'

    return (
      <XStack jc="space-between" gap="$2" ai="center">
        <H4>
          {title}{' '}
          {showSeats &&
            !!groupInfoData &&
            `(${groupInfoData?.currentlyOccupiedSeats}/${groupInfoData?.discordSeats})`}
        </H4>

        {showResetButton && (
          <Button
            size="$2"
            onPress={() => resetChannelMutation.trigger()}
            disabled={resetChannelMutation.isMutating}
          >
            {resetChannelMutation.isMutating ? 'Resetting...' : 'Reset'}
          </Button>
        )}
      </XStack>
    )
  }

  const renderDiscordAccessContent = () => {
    if (isLoading) {
      return (
        <XStack ai="center" jc="center" p="$4">
          <Spinner size="small" />
        </XStack>
      )
    }

    if (isTeamMember) {
      return (
        <Paragraph size="$3" theme="alt1">
          Only the team owner can manage Discord access.
        </Paragraph>
      )
    }

    // For support channels, check if user has any support access
    if (apiType === 'support') {
      const supportAccess = hasSupportAccess()
      if (!supportAccess.hasAccess) {
        return (
          <YStack gap="$4" p="$4" backgroundColor="$color2" br="$4">
            <Paragraph theme="alt2" ta="center">
              You need a Chat Support or Support tier subscription to access private
              support channels.
            </Paragraph>
          </YStack>
        )
      }
    }

    if (groupInfoData.currentlyOccupiedSeats < groupInfoData.discordSeats) {
      return <SearchForm />
    }

    return (
      <Paragraph size="$3" theme="alt1">
        You've reached the maximum number of Discord members for your plan. Please reset
        if you want to add new members.
      </Paragraph>
    )
  }

  return (
    <YStack gap="$3">
      <DiscordAccessHeader />

      {apiType === 'channel' ? (
        <Paragraph theme="alt2">
          Join the #takeout-general channel to discuss Tamagui with other Pro users.
        </Paragraph>
      ) : (
        <Paragraph theme="alt2">
          Get access to your private support channel where you can directly communicate
          with the Tamagui team.
        </Paragraph>
      )}

      {renderDiscordAccessContent()}
    </YStack>
  )
}

const DiscordMember = ({
  member,
  subscriptionId,
  apiType,
}: {
  member: APIGuildMember
  subscriptionId: string
  apiType: 'channel' | 'support'
}) => {
  const { data, error, isMutating, trigger } = useSWRMutation(
    [`/api/discord/${apiType}`, 'POST', member.user?.id],
    async () => {
      const res = await fetch(`/api/discord/${apiType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: subscriptionId,
          discord_id: member.user?.id,
        }),
      })

      if (!res.ok) {
        let errorMessage = `HTTP ${res.status} ${res.statusText}`

        try {
          const errorData = await res.json()
          errorMessage = errorData.message || errorMessage
        } catch {
          errorMessage = 'An unknown error occurred'
        }
        throw new Error(errorMessage)
      }
      return await res.json()
    },
    {
      onSuccess: async () => {
        await mutate(
          `/api/discord/${apiType}?${new URLSearchParams({
            subscription_id: subscriptionId,
          })}`
        )
      },
    }
  )

  const name = member.nick || member.user?.global_name
  const username = `${member.user?.username}${
    member.user?.discriminator !== '0' ? `#${member.user?.discriminator}` : ''
  }`
  const avatarSrc = member.user?.avatar
    ? `https://cdn.discordapp.com/avatars/${member.user?.id}/${member.user?.avatar}.png`
    : null

  return (
    <XStack gap="$2" ai="center" flexWrap="wrap">
      <Button minWidth={70} size="$2" disabled={isMutating} onPress={() => trigger()}>
        {isMutating ? 'Inviting...' : 'Add'}
      </Button>
      <Avatar circular size="$2">
        <Avatar.Image accessibilityLabel={`avatar for ${username}`} src={avatarSrc!} />
        <Avatar.Fallback backgroundColor="$blue10" />
      </Avatar>
      <Paragraph>{`${username}${name ? ` (${name})` : ''}`}</Paragraph>
      {data && (
        <Paragraph size="$1" theme="green">
          {data.message}
        </Paragraph>
      )}
      {error && (
        <Paragraph size="$1" theme="red">
          {error.message}
        </Paragraph>
      )}
    </XStack>
  )
}

const PlanTab = ({
  subscription,
  supportSubscription,
  setCurrentTab,
  isTeamMember,
}: {
  subscription?: Subscription
  supportSubscription?: Subscription
  setCurrentTab: (value: 'plan' | 'upgrade' | 'manage' | 'team') => void
  isTeamMember: boolean
}) => {
  const [showDiscordAccess, setShowDiscordAccess] = useState(false)
  const [showSupportAccess, setShowSupportAccess] = useState(false)
  const { data: products } = useProducts()
  const [isGrantingAccess, setIsGrantingAccess] = useState(false)

  // Check if this is a one-time payment plan
  const isOneTimePlan =
    subscription?.subscription_items?.[0]?.price?.type === Pricing.OneTime

  const handleTakeoutAccess = async () => {
    if (!subscription || !products) return

    const takeoutProduct = products.pro
    if (!takeoutProduct) {
      alert('Product information not found')
      return
    }

    setIsGrantingAccess(true)

    try {
      const res = await fetch(`/api/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: subscription.id,
          product_id: takeoutProduct.id,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        alert(data?.error || `Error: ${res.status} ${res.statusText}`)
      } else {
        if (data.url) {
          // Open URL in new tab
          window.open(data.url, '_blank', 'noopener,noreferrer')
        } else if (data.message) {
          alert(data.message)
        }
      }
    } finally {
      setIsGrantingAccess(false)
    }
  }

  return (
    <YStack gap="$6">
      <YStack gap="$4">
        <XStack fw="wrap" gap="$3">
          <ServiceCard
            title="Takeout"
            description="Access to repository and updates."
            actionLabel={
              subscription
                ? isGrantingAccess
                  ? 'Granting Access...'
                  : 'View Repository'
                : 'Purchase'
            }
            onAction={() => {
              if (!subscription) {
                paymentModal.show = true
              } else {
                handleTakeoutAccess()
              }
            }}
          />

          <BentoCard subscription={subscription as Subscription} />

          <ServiceCard
            title="Discord Access"
            description="Manage your Discord server access and invites."
            actionLabel={subscription ? 'Manage Access' : 'Purchase'}
            onAction={() => {
              if (!subscription) {
                // Unreachable but just in case
                paymentModal.show = true
              } else {
                setShowDiscordAccess(true)
              }
            }}
          />

          {/* Private Support Channels for Chat/Support users */}
          {supportSubscription && (
            <ServiceCard
              title="Private Support"
              description="Access your private Discord support channel with priority responses from the Tamagui team."
              actionLabel="Manage Support"
              onAction={() => {
                setShowSupportAccess(true)
              }}
            />
          )}

          <ServiceCard
            title="Theme AI"
            description="Prompt an LLM to generate themes."
            actionLabel="Go"
            onAction={() => {
              accountModal.show = false
              setTimeout(() => {
                router.navigate('/theme')
              })
            }}
          />

          <ChatAccessCard />
          {!isTeamMember && !isOneTimePlan ? (
            <ServiceCard
              title="Add Members"
              description="Add members to your Pro plan."
              actionLabel="Add Seats"
              onAction={() => {
                if (!subscription) {
                  paymentModal.show = true
                  paymentModal.teamSeats = 1
                } else {
                  addTeamMemberModal.subscriptionId = subscription.id
                  addTeamMemberModal.show = true
                }
              }}
            />
          ) : (
            <View flex={1} w={300} />
          )}
        </XStack>
      </YStack>

      {subscription?.status === 'active' && (
        <YStack gap="$4">
          <H3>Support Services</H3>
          <XStack fw="wrap" gap="$4">
            <ServiceCard
              title="Discord Support"
              description="Access to private Discord support channels"
              actionLabel="Join Discord"
              onAction={() => {
                router.navigate('https://discord.gg/4qh6tdcVDa')
                // Add Discord join logic
              }}
            />
            <ServiceCard
              title="Priority Support"
              description="Direct support and prioritized issue handling"
              actionLabel={subscription ? 'Contact Support' : 'Upgrade'}
              onAction={() => {
                setCurrentTab('upgrade')
              }}
            />
          </XStack>
        </YStack>
      )}

      {/* General Discord Access Dialog for PRO users */}
      {showDiscordAccess && subscription && (
        <DiscordAccessDialog
          subscription={subscription}
          onClose={() => setShowDiscordAccess(false)}
          isTeamMember={isTeamMember}
          apiType="channel"
        />
      )}

      {/* Private Support Access Dialog for Chat/Support users */}
      {showSupportAccess && supportSubscription && (
        <DiscordAccessDialog
          subscription={supportSubscription}
          onClose={() => setShowSupportAccess(false)}
          isTeamMember={isTeamMember}
          apiType="support"
        />
      )}
    </YStack>
  )
}

const ChatAccessCard = () => {
  const chatAccess = useSWR<any>(
    `/api/start-chat`,
    (url) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then((res) => res.json()),
    { revalidateOnFocus: false, revalidateOnReconnect: false, errorRetryCount: 0 }
  )

  return (
    <ServiceCard
      title="Chat"
      description={
        chatAccess.data?.success
          ? `You're signed up! Go chat!`
          : 'First, register. Click the user icon, signup with Github, then come back here and authorize.'
      }
      actionLabel={
        chatAccess.isLoading
          ? 'Checking access...'
          : chatAccess.data?.success
            ? 'Open ➤'
            : 'First: Register ➤'
      }
      onAction={() => {
        if (chatAccess.isLoading) {
          alert(`Still loading chat access...`)
          return
        }
        if (chatAccess.data?.success) {
          window.open(`https://start.chat/tamagui/q0upl90r4xd`)
          return
        }
        window.open(`https://start.chat/tamagui`)
      }}
      secondAction={
        chatAccess.isLoading || chatAccess.data?.success
          ? null
          : {
              label: `Second: Authorize`,
              onPress() {
                chatAccess.mutate()
              },
            }
      }
    />
  )
}

const UpgradeTab = () => {
  const { subscriptionStatus } = useUser()

  const [supportTier, setSupportTier] = useState(subscriptionStatus.supportTier)
  const currentTier = subscriptionStatus.supportTier

  const getActionLabel = () => {
    if (supportTier === currentTier) return 'Current Plan'
    return Number(supportTier) > Number(currentTier) ? 'Upgrade Plan' : 'Downgrade Plan'
  }

  const handleUpgrade = () => {
    // Calculate the monthly total based on support tier
    const monthlyTotal = Number(supportTier) * 800

    // Set payment modal properties
    paymentModal.show = true
    paymentModal.yearlyTotal = 0 // No yearly component for support upgrade
    paymentModal.monthlyTotal = monthlyTotal
    paymentModal.disableAutoRenew = false // Support is always monthly
    paymentModal.chatSupport = false
    paymentModal.supportTier = Number(supportTier)
  }

  return (
    <YStack gap="$6">
      <SupportTabContent
        currentTier={currentTier.toString()}
        supportTier={supportTier.toString()}
        setSupportTier={(value) => setSupportTier(Number(value))}
      />

      <Button
        fontFamily="$mono"
        theme="accent"
        br="$10"
        als="flex-end"
        onPress={handleUpgrade}
        disabled={supportTier === currentTier}
      >
        {getActionLabel()}
      </Button>

      <Separator />

      <Paragraph ff="$mono" size="$5" lineHeight="$6" o={0.8}>
        Each tier adds 4 hours of development a month, faster response times, and 4
        additional private chat invites.
      </Paragraph>
    </YStack>
  )
}

const SupportTabContent = ({
  currentTier,
  supportTier,
  setSupportTier,
}: {
  currentTier: string
  supportTier: string
  setSupportTier: (value: string) => void
}) => {
  const tiers = [
    { value: '0', label: 'None', price: 0 },
    { value: '1', label: 'Tier 1', price: 800 },
    { value: '2', label: 'Tier 2', price: 1600 },
    { value: '3', label: 'Tier 3', price: 3000 },
  ]

  const formatCurrency = (price: number) => {
    return price.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    })
  }

  return (
    <YStack gap="$6">
      <YStack gap="$4">
        {tiers.map((tier) => (
          <YStack
            key={tier.value}
            borderWidth={1}
            theme={supportTier === tier.value ? 'accent' : null}
            borderRadius="$4"
            borderColor="$color4"
            p="$4"
            bg="$color1"
            cursor="pointer"
            onPress={() => setSupportTier(tier.value)}
          >
            <XStack jc="space-between" ai="center">
              <YStack gap="$1">
                <H3 fontFamily="$mono" size="$6">
                  {tier.label}
                </H3>
                <Paragraph theme="alt1">
                  {tier.price === 0
                    ? 'Basic Support'
                    : `${formatCurrency(tier.price)}/month`}
                </Paragraph>
              </YStack>
              {currentTier === tier.value && <Paragraph>Current Plan</Paragraph>}
            </XStack>
          </YStack>
        ))}
      </YStack>
    </YStack>
  )
}

const ManageTab = ({
  subscriptions,
  isTeamMember,
  teamData,
  isTeamLoading,
}: {
  subscriptions: Subscription[]
  isTeamMember: boolean
  teamData: TeamSubscription | undefined
  isTeamLoading: boolean
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const { refresh } = useUser()

  if (isTeamLoading) {
    return (
      <YStack f={1} ai="center" jc="center" p="$6">
        <Spinner size="large" />
      </YStack>
    )
  }

  if (!subscriptions || subscriptions.length === 0) {
    return (
      <YStack gap="$4">
        <H3>No Active Subscription</H3>
        <Paragraph theme="alt1">
          You don't have an active subscription. Purchase a plan to get started.
        </Paragraph>
        <Button
          themeInverse
          onPress={() => {
            paymentModal.show = true
          }}
        >
          Purchase Plan
        </Button>
      </YStack>
    )
  }

  // Sort subscriptions by creation date (oldest first)
  const sortedSubscriptions = [...subscriptions].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  )

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100)
  }

  // Cancel handler for a specific subscription
  const handleCancelSubscription = async (subscriptionId: string) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: subscriptionId,
        }),
      })

      const data = await res.json()
      if (data.message) {
        alert(data.message)
        refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <YStack gap="$6">
      <View>
        <H3>Subscription Details</H3>
        {isTeamMember && <Paragraph color="$green9">You are a member</Paragraph>}
      </View>
      {sortedSubscriptions.map((subscription) => {
        const subscriptionItems = subscription?.subscription_items || []
        return (
          <YStack
            key={subscription.id}
            gap="$4"
            p="$4"
            borderWidth={1}
            borderColor="$color3"
            borderRadius="$4"
            mb="$4"
          >
            <YStack
              p="$4"
              borderWidth={1}
              borderColor="$color3"
              borderRadius="$4"
              width="100%"
              style={{
                overflowX: 'auto',
              }}
            >
              <YStack minWidth={500} width="100%">
                {/* Table Header */}
                <XStack ai="center" mb="$2" width="100%">
                  <Paragraph fontWeight="bold" width="60%">
                    Product
                  </Paragraph>
                  <Paragraph fontWeight="bold" width="20%" textAlign="center">
                    Qty
                  </Paragraph>
                  <Paragraph fontWeight="bold" width="20%" textAlign="right">
                    Total
                  </Paragraph>
                </XStack>
                {/* Table Rows */}
                {subscriptionItems.map((item, idx) => {
                  const price = item.price
                  const product = price?.product
                  const qty =
                    product?.name === ProductName.TamaguiProTeamSeats
                      ? (teamData?.subscription.total_seats ?? 1)
                      : (subscription.quantity ?? 1)
                  const total = (price?.unit_amount || 0) * qty
                  return (
                    <XStack key={item.id || idx} ai="center" mb="$2" width="100%">
                      <YStack width="60%">
                        <Paragraph fontWeight="bold">{product?.name}</Paragraph>
                        {product?.description && (
                          <Paragraph theme="alt2" size="$3">
                            {product.description}
                          </Paragraph>
                        )}
                        <Paragraph>
                          {formatCurrency(price?.unit_amount || 0)}
                          {price?.type !== Pricing.OneTime && price?.interval
                            ? `/${price.interval}`
                            : ''}
                        </Paragraph>
                      </YStack>
                      <Paragraph width="20%" textAlign="center">
                        {qty}
                      </Paragraph>
                      <Paragraph width="20%" textAlign="right">
                        {formatCurrency(total)}
                        {price?.type !== Pricing.OneTime && price?.interval
                          ? `/${price.interval}`
                          : ''}
                      </Paragraph>
                    </XStack>
                  )
                })}
              </YStack>
            </YStack>
            {/* Billing Period, Status, Cancel Button */}
            <XStack jc="space-between">
              <Paragraph flex={1}>Status</Paragraph>
              <Paragraph
                textTransform="capitalize"
                flex={1}
                textAlign="right"
                color={
                  subscription.status === SubscriptionStatus.Active
                    ? '$green9'
                    : '$yellow9'
                }
              >
                {subscription.status === SubscriptionStatus.Trialing
                  ? SubscriptionStatus.Active
                  : subscription.status}
              </Paragraph>
            </XStack>
            <XStack jc="space-between">
              <Paragraph flex={1}>Billing Period</Paragraph>
              <YStack ai="flex-end">
                <Paragraph>
                  {new Date(subscription.current_period_start).toLocaleDateString()} -{' '}
                  {new Date(subscription.current_period_end).toLocaleDateString()}
                </Paragraph>
              </YStack>
            </XStack>
            {subscription.cancel_at_period_end && (
              <YStack backgroundColor="$yellow2" p="$3" borderRadius="$4">
                <Paragraph theme="yellow">
                  Your subscription will end on{' '}
                  {new Date(subscription.current_period_end).toLocaleDateString()}
                </Paragraph>
              </YStack>
            )}
            {/* Cancel button logic here */}
            {!isTeamMember ? (
              <>
                <Separator />
                <Button
                  theme="red"
                  disabled={isLoading || !!subscription.cancel_at_period_end}
                  onPress={() => handleCancelSubscription(subscription.id)}
                >
                  {subscription.cancel_at_period_end
                    ? 'Cancellation Scheduled'
                    : 'Cancel Subscription'}
                </Button>
              </>
            ) : null}
          </YStack>
        )
      })}
    </YStack>
  )
}

type GitHubUser = {
  id: string
  full_name: string | null
  avatar_url: string | null
  email: string | null
}

const TeamTab = ({
  teamData,
  isTeamLoading,
  teamError,
}: {
  teamData: TeamSubscription | undefined
  isTeamLoading: boolean
  teamError: any
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<GitHubUser[]>([])

  const searchUsers = useMemo(
    () =>
      debounce(async (query: string) => {
        if (!query) {
          setSearchResults([])
          return
        }
        setIsSearching(true)
        try {
          const response = await fetch(`/api/github/users?q=${query}`)
          const data = await response.json()
          if (response.ok) {
            setSearchResults(data.users)
          } else {
            console.error('Search failed:', data.error)
          }
        } catch (error) {
          console.error('Search error:', error)
        } finally {
          setIsSearching(false)
        }
      }, 300),
    []
  )

  useEffect(() => {
    searchUsers(searchQuery)
  }, [searchQuery, searchUsers])

  if (isTeamLoading) {
    return (
      <YStack f={1} ai="center" jc="center">
        <Spinner size="large" />
      </YStack>
    )
  }

  if (teamError || !teamData) {
    return (
      <YStack gap="$4">
        <H3>No Team Subscription</H3>
        <Paragraph theme="alt1">
          Purchase team seats to invite team members to your Tamagui Pro subscription.
        </Paragraph>
        <Button
          theme="accent"
          onPress={() => {
            paymentModal.show = true
            paymentModal.teamSeats = 1
          }}
        >
          Purchase Team Seats
        </Button>
      </YStack>
    )
  }

  return (
    <YStack gap="$6">
      <YStack gap="$4">
        <H3>Team Management</H3>
        <XStack ai="center" jc="space-between">
          <Paragraph theme="alt1">
            {teamData.subscription.used_seats || 0} of {teamData.subscription.total_seats}{' '}
            seats used
          </Paragraph>
        </XStack>
      </YStack>

      {teamData.subscription.used_seats < teamData.subscription.total_seats && (
        <YStack gap="$4">
          <H4>Invite Team Member</H4>
          <Form gap="$2">
            <XStack gap="$2" ai="flex-end">
              <Fieldset f={1}>
                <Label htmlFor="github-username">Name / Email / Id</Label>
                <Input
                  id="github-username"
                  placeholder="Search GitHub users by name, email, or id"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </Fieldset>
            </XStack>
          </Form>

          <YStack gap="$2">
            {isSearching ? (
              <XStack p="$2" ai="center" jc="center">
                <Spinner size="small" />
              </XStack>
            ) : searchResults.length > 0 ? (
              searchResults.map((githubUser) => (
                <GitHubUserRow
                  key={githubUser.id}
                  user={githubUser}
                  subscriptionId={teamData.subscription.id}
                />
              ))
            ) : searchQuery.length > 0 ? (
              <YStack gap={0}>
                <Paragraph theme="alt1">No results found</Paragraph>
                <Paragraph theme="alt1">User is not a member of Tamagui</Paragraph>
              </YStack>
            ) : null}
          </YStack>
        </YStack>
      )}

      <Separator />

      <YStack gap="$4">
        <H4>Team Members</H4>
        <YStack gap="$2">
          {teamData.members.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              subscriptionId={teamData.subscription.id}
            />
          ))}
        </YStack>
      </YStack>
    </YStack>
  )
}

const GitHubUserRow = ({
  user,
  subscriptionId,
}: {
  user: GitHubUser
  subscriptionId: string
}) => {
  const {
    trigger: inviteTeamMember,
    isMutating: isInviting,
    error: inviteError,
  } = useInviteTeamMember(subscriptionId)

  return (
    <XStack
      borderWidth={1}
      borderColor="$color3"
      borderRadius="$4"
      p="$3"
      ai="center"
      jc="space-between"
    >
      <XStack ai="center" gap="$3">
        <Avatar circular size="$3">
          <Avatar.Image source={{ uri: user.avatar_url ?? '' }} />
        </Avatar>
        <YStack>
          <Paragraph>{user.full_name ?? 'Unknown User'}</Paragraph>
          <Paragraph size="$2" theme="alt2">
            {user.email ?? 'Unknown Email'}
          </Paragraph>
          {inviteError && (
            <Paragraph size="$2" color="$red10">
              Error: {inviteError.message}
            </Paragraph>
          )}
        </YStack>
      </XStack>

      <Button
        theme="accent"
        size="$2"
        onPress={() => inviteTeamMember({ user_id: String(user.id) })}
        disabled={isInviting}
      >
        {isInviting ? 'Inviting...' : 'Invite'}
      </Button>
    </XStack>
  )
}

const TeamMemberRow = ({
  member,
  subscriptionId,
}: {
  member: TeamMember
  subscriptionId: string
}) => {
  const { trigger: removeTeamMember, isMutating: isRemoving } =
    useRemoveTeamMember(subscriptionId)

  return (
    <XStack
      borderWidth={1}
      borderColor="$color3"
      borderRadius="$4"
      p="$3"
      ai="center"
      jc="space-between"
    >
      <XStack ai="center" gap="$3">
        <Avatar circular size="$3">
          <Avatar.Image
            source={{
              uri:
                member.user?.avatar_url ??
                getDefaultAvatarImage(member.user?.full_name ?? ''),
            }}
          />
        </Avatar>
        <YStack>
          <Paragraph>{member.user?.full_name ?? 'Unknown User'}</Paragraph>
          <Paragraph theme="alt2" size="$2">
            {member.user?.email}
          </Paragraph>
        </YStack>
      </XStack>

      <XStack ai="center" gap="$2">
        <Paragraph size="$2" theme="alt2">
          {member.role}
        </Paragraph>
        <Button
          theme="red"
          size="$2"
          onPress={() => removeTeamMember({ team_member_id: member.user?.id ?? '' })}
          disabled={isRemoving}
        >
          {isRemoving ? 'Removing...' : 'Remove'}
        </Button>
      </XStack>
    </XStack>
  )
}

const BentoCard = ({ subscription }: { subscription?: Subscription }) => {
  const supabase = useSupabaseClient()
  const { onCopy, hasCopied } = useClipboard()

  const { data, isLoading, mutate } = useSWR(
    '/api/bento/cli/login',
    async (url) => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch access token')
      }
      return response.json()
    },
    {
      revalidateOnMount: false,
      revalidateOnFocus: false,
    }
  )

  const handleBentoDownload = async () => {
    if (!supabase) {
      alert('Authentication required')
      return
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        alert('Please sign in to download Bento components')
        return
      }

      const response = await fetch('/api/bento/zip-download', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to download Bento components')
      }

      // Create a blob from the response
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'bento-bundle.zip'
      document.body.appendChild(a)
      a.click()

      // Cleanup
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      alert('Failed to download Bento components. Please try again later.')
    }
  }

  const onCopyCode = async () => {
    if (hasCopied || isLoading) return

    const token = data?.accessToken
    if (token) {
      onCopy(token)
    } else {
      const res = await mutate()
      const token = res?.accessToken
      if (token) onCopy(token)
    }
  }

  return (
    <ServiceCard
      title="Bento"
      description="Download the entire suite of Bento components."
      actionLabel="Download"
      onAction={handleBentoDownload}
      secondAction={
        subscription
          ? {
              label: hasCopied ? 'Copied' : isLoading ? 'Loading...' : `Copy Code`,
              onPress: onCopyCode,
            }
          : null
      }
    />
  )
}
