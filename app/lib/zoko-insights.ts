import { prisma } from "@/lib/prisma";

export interface LiveMonitorSnapshot {
  generatedAt: string;
  totals: {
    openChats: number;
    waitingCustomers: number;
    unassignedChats: number;
    averageWaitMinutes: number;
  };
  agentLoad: AgentLoadItem[];
  activeChats: ActiveChatItem[];
  recentMessages: RecentMessageItem[];
}

export interface AgentLoadItem {
  agentId: string | null;
  agentName: string;
  agentEmail: string | null;
  activeChats: number;
  waitingChats: number;
  lastAssignedAt: string | null;
}

export interface ActiveChatItem {
  id: string;
  customerName: string | null;
  chatType: string | null;
  status: string;
  platform: string | null;
  platformSenderId: string | null;
  lastMessageAt: string | null;
  lastDirection: string | null;
  lastMessageText: string | null;
  assignedAgent: {
    agentId: string | null;
    agentName: string;
    assignedAt: string | null;
  } | null;
}

export interface RecentMessageItem {
  id: string;
  chatId: string;
  senderName: string | null;
  direction: string | null;
  text: string | null;
  platformTimestamp: string | null;
}

export interface AgentReportFilters {
  from: Date;
  to: Date;
  agentId?: string;
}

export interface AgentPerformanceSummary {
  range: { from: string; to: string };
  totals: {
    assigned: number;
    closed: number;
    outgoingMessages: number;
    incomingMessages: number;
    averageResolutionMinutes: number;
  };
  agents: AgentReportRow[];
  availableAgents: { id: string; name: string | null; email: string | null }[];
}

export interface AgentReportRow {
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  assignedChats: number;
  closedChats: number;
  outgoingMessages: number;
  avgResolutionMinutes: number;
  firstAssignmentAt: string | null;
  lastAssignmentAt: string | null;
  lastClosureAt: string | null;
}

export async function getLiveMonitorSnapshot(): Promise<LiveMonitorSnapshot> {
  const [chats, messages] = await Promise.all([
    prisma.zokoChat.findMany({
      where: { status: { not: "closed" } },
      include: {
        assignments: {
          orderBy: { eventAt: "desc" },
          take: 1,
          include: { agent: true },
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    }),
    prisma.zokoMessage.findMany({
      orderBy: { platformTimestamp: "desc" },
      take: 20,
    }),
  ]);

  const now = new Date();
  const waitingChats = chats.filter((chat) => chat.lastDirection === "FROM_CUSTOMER");
  const unassignedChats = chats.filter((chat) => !chat.assignments.length).length;
  const avgWaitMinutes = waitingChats.length
    ? Math.round(
        waitingChats.reduce((total, chat) => {
          if (!chat.lastMessageAt) return total;
          const diffMs = now.getTime() - chat.lastMessageAt.getTime();
          return total + Math.max(0, diffMs / 60000);
        }, 0) / waitingChats.length,
      )
    : 0;

  const agentLoadMap = new Map<string, AgentLoadItem>();
  const activeChats: ActiveChatItem[] = chats.map((chat) => {
    const assignment = chat.assignments[0];
    const agentKey = assignment?.agentId ?? "unassigned";

    if (!agentLoadMap.has(agentKey)) {
      agentLoadMap.set(agentKey, {
        agentId: assignment?.agentId ?? null,
        agentName:
          assignment?.agent?.name ||
          assignment?.agent?.email ||
          (assignment?.agentId ? `Agent ${assignment.agentId.slice(0, 4)}` : "بلا تعيين"),
        agentEmail: assignment?.agent?.email ?? null,
        activeChats: 0,
        waitingChats: 0,
        lastAssignedAt: assignment?.eventAt?.toISOString() ?? null,
      });
    }

    const agentEntry = agentLoadMap.get(agentKey)!;
    agentEntry.activeChats += 1;
    if (chat.lastDirection === "FROM_CUSTOMER") {
      agentEntry.waitingChats += 1;
    }
    if (assignment?.eventAt) {
      const previous = agentEntry.lastAssignedAt ? new Date(agentEntry.lastAssignedAt) : null;
      if (!previous || assignment.eventAt > previous) {
        agentEntry.lastAssignedAt = assignment.eventAt.toISOString();
      }
    }

    return {
      id: chat.id,
      customerName: chat.customerName,
      chatType: chat.chatType,
      status: chat.status,
      platform: chat.platform,
      platformSenderId: chat.platformSenderId,
      lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
      lastDirection: chat.lastDirection,
      lastMessageText: chat.lastMessageText,
      assignedAgent: assignment
        ? {
            agentId: assignment.agentId ?? null,
            agentName:
              assignment.agent?.name ||
              assignment.agent?.email ||
              (assignment.agentId ? `Agent ${assignment.agentId.slice(0, 4)}` : "بلا تعيين"),
            assignedAt: assignment.eventAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  const agentLoad = Array.from(agentLoadMap.values()).sort((a, b) => b.activeChats - a.activeChats);
  const recentMessages: RecentMessageItem[] = messages.map((message) => ({
    id: message.id,
    chatId: message.chatId,
    senderName: message.senderName,
    direction: message.direction,
    text: message.text,
    platformTimestamp: message.platformTimestamp?.toISOString() ?? null,
  }));

  return {
    generatedAt: now.toISOString(),
    totals: {
      openChats: chats.length,
      waitingCustomers: waitingChats.length,
      unassignedChats,
      averageWaitMinutes: avgWaitMinutes,
    },
    agentLoad,
    activeChats,
    recentMessages,
  };
}

export async function getAgentPerformanceReport(
  filters: AgentReportFilters,
): Promise<AgentPerformanceSummary> {
  const agents = await prisma.zokoAgent.findMany({
    orderBy: { name: "asc" },
    where: filters.agentId ? { id: filters.agentId } : undefined,
  });

  const [assignments, closures, outgoingCounts, incomingMessages] = await Promise.all([
    prisma.zokoChatAssignment.findMany({
      where: {
        eventAt: { gte: filters.from, lte: filters.to },
        ...(filters.agentId ? { agentId: filters.agentId } : {}),
      },
      include: { agent: true },
    }),
    prisma.zokoChatClosure.findMany({
      where: {
        eventAt: { gte: filters.from, lte: filters.to },
        ...(filters.agentId ? { agentId: filters.agentId } : {}),
      },
      include: { agent: true },
    }),
    prisma.zokoMessage.groupBy({
      by: ["agentEmail"],
      _count: { _all: true },
      where: {
        direction: "FROM_STORE",
        platformTimestamp: { gte: filters.from, lte: filters.to },
        agentEmail: { not: null },
        ...(filters.agentId
          ? {
              agentEmail: {
                in: agents
                  .map((agent) => agent.email)
                  .filter((email): email is string => Boolean(email)),
              },
            }
          : {}),
      },
    }),
    prisma.zokoMessage.count({
      where: {
        direction: "FROM_CUSTOMER",
        platformTimestamp: { gte: filters.from, lte: filters.to },
      },
    }),
  ]);

  const knownAgentEmails = collectKnownAgentEmails(agents, assignments, closures, outgoingCounts);
  const orderUsers = knownAgentEmails.length
    ? await prisma.orderUser.findMany({
        where: {
          OR: knownAgentEmails.map((email) => ({
            email: { equals: email, mode: "insensitive" },
          })),
        },
        select: {
          email: true,
          name: true,
          username: true,
        },
      })
    : [];

  const agentNameByEmail = new Map<string, string>();
  orderUsers.forEach((user) => {
    setAgentNameByEmail(agentNameByEmail, user.email, user.name ?? user.username);
  });
  agents.forEach((agent) => {
    setAgentNameByEmail(agentNameByEmail, agent.email, agent.name);
  });
  assignments.forEach((assignment) => {
    setAgentNameByEmail(agentNameByEmail, assignment.agent?.email, assignment.agent?.name);
  });
  closures.forEach((closure) => {
    setAgentNameByEmail(agentNameByEmail, closure.agent?.email, closure.agent?.name);
  });

  const summaryMap = new Map<string, SummaryMutable>();
  const summaryEntries: SummaryMutable[] = [];
  const assignmentStartMap = new Map<string, Date>();

  agents.forEach((agent) => {
    const entry = ensureSummaryEntry(summaryMap, summaryEntries, {
      agentId: agent.id,
      email: agent.email,
      name: resolveAgentName(agent.name, agent.email, agentNameByEmail),
    });
    entry.agentEmail = agent.email ?? null;
  });

  assignments.forEach((assignment) => {
    const entry = ensureSummaryEntry(summaryMap, summaryEntries, {
      agentId: assignment.agentId ?? undefined,
      email: assignment.agent?.email,
      name: resolveAgentName(assignment.agent?.name, assignment.agent?.email, agentNameByEmail),
    });
    entry.assignedChats += 1;
    entry.firstAssignmentAt = pickEarlier(entry.firstAssignmentAt, assignment.eventAt);
    entry.lastAssignmentAt = pickLater(entry.lastAssignmentAt, assignment.eventAt);

    const assignmentKey = buildAssignmentKey(
      assignment.chatId,
      assignment.agentId,
      assignment.agent?.email,
    );
    const currentStart = assignmentStartMap.get(assignmentKey);
    if (!currentStart || assignment.eventAt < currentStart) {
      assignmentStartMap.set(assignmentKey, assignment.eventAt);
    }
  });

  closures.forEach((closure) => {
    const entry = ensureSummaryEntry(summaryMap, summaryEntries, {
      agentId: closure.agentId ?? undefined,
      email: closure.agent?.email,
      name: resolveAgentName(closure.agent?.name, closure.agent?.email, agentNameByEmail),
    });
    entry.closedChats += 1;
    entry.lastClosureAt = pickLater(entry.lastClosureAt, closure.eventAt);

    const assignmentKey = buildAssignmentKey(closure.chatId, closure.agentId, closure.agent?.email);
    const start = assignmentStartMap.get(assignmentKey);
    if (start) {
      const minutes = Math.max(0, (closure.eventAt.getTime() - start.getTime()) / 60000);
      entry.resolutionMinutesTotal += minutes;
      entry.resolutionSamples += 1;
    }
  });

  outgoingCounts.forEach((group) => {
    if (!group.agentEmail) return;
    const entry = ensureSummaryEntry(summaryMap, summaryEntries, {
      email: group.agentEmail,
      name: resolveAgentName(null, group.agentEmail, agentNameByEmail),
    });
    entry.outgoingMessages += group._count._all;
  });

  const agentsList = summaryEntries.map<AgentReportRow>((entry) => ({
    agentId: entry.agentId,
    agentName: entry.agentName,
    agentEmail: entry.agentEmail,
    assignedChats: entry.assignedChats,
    closedChats: entry.closedChats,
    outgoingMessages: entry.outgoingMessages,
    avgResolutionMinutes: entry.resolutionSamples
      ? Math.round(entry.resolutionMinutesTotal / entry.resolutionSamples)
      : 0,
    firstAssignmentAt: entry.firstAssignmentAt,
    lastAssignmentAt: entry.lastAssignmentAt,
    lastClosureAt: entry.lastClosureAt,
  }));

  const totals = agentsList.reduce(
    (acc, agent) => {
      acc.assigned += agent.assignedChats;
      acc.closed += agent.closedChats;
      acc.outgoingMessages += agent.outgoingMessages;
      if (agent.avgResolutionMinutes) {
        acc.resolutionTotals.sum += agent.avgResolutionMinutes * agent.closedChats;
        acc.resolutionTotals.count += agent.closedChats;
      }
      return acc;
    },
    {
      assigned: 0,
      closed: 0,
      outgoingMessages: 0,
      resolutionTotals: { sum: 0, count: 0 },
    },
  );

  const averageResolutionMinutes =
    totals.resolutionTotals.count > 0
      ? Math.round(totals.resolutionTotals.sum / totals.resolutionTotals.count)
      : 0;

  return {
    range: { from: filters.from.toISOString(), to: filters.to.toISOString() },
    totals: {
      assigned: totals.assigned,
      closed: totals.closed,
      outgoingMessages: totals.outgoingMessages,
      incomingMessages,
      averageResolutionMinutes,
    },
    agents: agentsList.sort((a, b) => b.assignedChats - a.assignedChats),
    availableAgents: agents.map((agent) => ({
      id: agent.id,
      name: resolveAgentName(agent.name, agent.email, agentNameByEmail),
      email: agent.email,
    })),
  };
}

interface SummaryMutable {
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  assignedChats: number;
  closedChats: number;
  outgoingMessages: number;
  firstAssignmentAt: string | null;
  lastAssignmentAt: string | null;
  lastClosureAt: string | null;
  resolutionMinutesTotal: number;
  resolutionSamples: number;
}

function ensureSummaryEntry(
  map: Map<string, SummaryMutable>,
  entries: SummaryMutable[],
  identity: { agentId?: string; email?: string | null; name?: string | null },
) {
  const normalizedEmail = identity.email?.toLowerCase() ?? null;
  const emailKey = normalizedEmail ? `email:${normalizedEmail}` : null;
  const agentKey = identity.agentId ?? null;
  const fallbackKey =
    agentKey ??
    emailKey ??
    (identity.name ? `name:${identity.name}` : "unassigned");

  let entry =
    (agentKey ? map.get(agentKey) : undefined) ??
    (emailKey ? map.get(emailKey) : undefined) ??
    (fallbackKey ? map.get(fallbackKey) : undefined);

  if (!entry) {
    entry = {
      agentId: identity.agentId ?? null,
      agentName: normalizeAgentName(identity.name),
      agentEmail: identity.email ?? null,
      assignedChats: 0,
      closedChats: 0,
      outgoingMessages: 0,
      firstAssignmentAt: null,
      lastAssignmentAt: null,
      lastClosureAt: null,
      resolutionMinutesTotal: 0,
      resolutionSamples: 0,
    };
    entries.push(entry);
  } else {
    if (!entry.agentId && identity.agentId) {
      entry.agentId = identity.agentId;
    }
    if (!entry.agentEmail && identity.email) {
      entry.agentEmail = identity.email;
    }
    if (!entry.agentName) {
      entry.agentName = normalizeAgentName(identity.name);
    }
  }

  if (fallbackKey) map.set(fallbackKey, entry);
  if (agentKey) map.set(agentKey, entry);
  if (emailKey) map.set(emailKey, entry);

  return entry;
}

function pickEarlier(current: string | null, next: Date) {
  if (!current) return next.toISOString();
  return new Date(current) > next ? next.toISOString() : current;
}

function pickLater(current: string | null, next: Date) {
  if (!current) return next.toISOString();
  return new Date(current) < next ? next.toISOString() : current;
}

function buildAssignmentKey(chatId: string, agentId?: string | null, agentEmail?: string | null) {
  if (agentId) return `${chatId}|${agentId}`;
  if (agentEmail) return `${chatId}|${agentEmail.toLowerCase()}`;
  return `${chatId}|unassigned`;
}

function collectKnownAgentEmails(
  agents: { email: string | null }[],
  assignments: { agent?: { email: string | null } | null }[],
  closures: { agent?: { email: string | null } | null }[],
  outgoingCounts: { agentEmail: string | null }[],
) {
  const emails = new Set<string>();

  agents.forEach((agent) => {
    if (agent.email) emails.add(agent.email);
  });
  assignments.forEach((assignment) => {
    if (assignment.agent?.email) emails.add(assignment.agent.email);
  });
  closures.forEach((closure) => {
    if (closure.agent?.email) emails.add(closure.agent.email);
  });
  outgoingCounts.forEach((group) => {
    if (group.agentEmail) emails.add(group.agentEmail);
  });

  return Array.from(emails);
}

function resolveAgentName(
  candidateName: string | null | undefined,
  email: string | null | undefined,
  agentNameByEmail: Map<string, string>,
) {
  const normalizedName = normalizeAgentName(candidateName);
  if (normalizedName) return normalizedName;
  if (!email) return null;
  return agentNameByEmail.get(email.toLowerCase()) ?? null;
}

function setAgentNameByEmail(
  agentNameByEmail: Map<string, string>,
  email: string | null | undefined,
  name: string | null | undefined,
) {
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedName = normalizeAgentName(name);
  if (!normalizedEmail || !normalizedName) return;
  agentNameByEmail.set(normalizedEmail, normalizedName);
}

function normalizeAgentName(name: string | null | undefined) {
  const normalizedName = name?.trim();
  return normalizedName ? normalizedName : null;
}
