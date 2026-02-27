import { defineCommand } from 'citty';
import { listCommand } from './list.js';
import { getCommand } from './get.js';
import { checkoutCommand } from './checkout.js';
import { noteCreateCommand } from './note-create.js';
import { noteCreateLineCommand } from './note-create-line.js';
import {
  discussionReplyCommand,
  discussionResolveCommand,
  discussionUnresolveCommand,
} from './discussion.js';
import { approveCommand, unapproveCommand } from './approve.js';
import { reviewSubmitCommand } from './review-submit.js';

const noteCommand = defineCommand({
  meta: { name: 'note', description: 'Manage MR notes' },
  subCommands: {
    create: noteCreateCommand,
    'create-line': noteCreateLineCommand,
  },
});

const discussionCommand = defineCommand({
  meta: { name: 'discussion', description: 'Manage MR discussions' },
  subCommands: {
    reply: discussionReplyCommand,
    resolve: discussionResolveCommand,
    unresolve: discussionUnresolveCommand,
  },
});

const reviewCommand = defineCommand({
  meta: { name: 'review', description: 'Batch review operations' },
  subCommands: {
    submit: reviewSubmitCommand,
  },
});

export const mrCommand = defineCommand({
  meta: { name: 'mr', description: 'Manage merge requests' },
  subCommands: {
    list: listCommand,
    get: getCommand,
    checkout: checkoutCommand,
    note: noteCommand,
    discussion: discussionCommand,
    approve: approveCommand,
    unapprove: unapproveCommand,
    review: reviewCommand,
  },
});
