import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { CardLink } from './card-link'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), enable: vi.fn(), rest: vi.fn() }))

vi.mock('react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/app/routes', () => ({
  navigateToWorkspacePage: (navigate: (path: string) => void, path: string) => navigate(path)
}))
vi.mock('@/contrib/plugins-store', () => ({ setPluginEnabled: mocks.enable }))
vi.mock('@/api/plugins', () => ({ pluginRest: mocks.rest }))
vi.mock('@/store/connections', () => ({ $activeConnectionId: atom('qa') }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('loads the existing Kanban view before opening a cached card on its board', async () => {
  let ready!: () => void
  mocks.enable.mockReturnValue(
    new Promise<void>(resolve => {
      ready = resolve
    })
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['card-reference', 'qa', 'default', 'work', 't_12345678'], {
    id: 't_12345678',
    title: 'Preserve my place',
    status: 'blocked',
    board: 'work'
  })
  render(
    <QueryClientProvider client={client}>
      <CardLink href="/m/board/t_12345678?board=work" />
    </QueryClientProvider>
  )
  const link = screen.getByRole('link', { name: /Preserve my place/ })
  expect(link.dataset.status).toBe('blocked')
  fireEvent.click(link)
  expect(mocks.enable).toHaveBeenCalledExactlyOnceWith('kanban', true)
  expect(mocks.navigate).not.toHaveBeenCalled()
  await act(async () => {
    ready()
  })
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/kanban?task=t_12345678&board=work')
  expect(mocks.rest).not.toHaveBeenCalled()
})
