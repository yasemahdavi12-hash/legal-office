const { validate } = require('../middleware/validate');

const idParam = { id: { in: 'params', required: true, type: 'id' } };

const CASE_STATUS = [
  'active', 'closed', 'waiting', 'supervision', 'need_action', 'archived',
  'pending', 'action'
];
const TASK_STATUS = ['todo', 'doing', 'done'];
const TASK_PRIORITY = ['high', 'med', 'low'];
const NOTE_CAT = ['general', 'hearing', 'client', 'legal', 'followup'];
const DOC_CAT = ['other', 'contract', 'client', 'pdf', 'image', 'legal', 'identity', 'financial', 'court'];
const EVENT_TYPE = [
  // legacy
  'meeting', 'court', 'supervision', 'reminder',
  // canonical
  'court_hearing', 'client_meeting', 'client_call', 'deadline',
  'document_deadline', 'payment_due', 'internal_meeting', 'personal'
];
const EVENT_STATUS = ['scheduled', 'cancelled', 'done'];
const PLATFORMS = ['bale', 'rubika'];

const cases = {
  create: validate(
    {
      case_number: { trim: true, maxLength: 80 },
      num: { trim: true, maxLength: 80 },
      archive_number: { trim: true, maxLength: 80 },
      archive: { trim: true, maxLength: 80 },
      branch: { trim: true, maxLength: 120 },
      title: { trim: true, maxLength: 255 },
      subject: { trim: true, maxLength: 255 },
      description: { trim: true, maxLength: 5000 },
      desc: { trim: true, maxLength: 5000 },
      status: { enum: CASE_STATUS }
    },
    { requireAny: [['case_number', 'num'], ['title', 'subject']] }
  ),
  update: validate({
    ...idParam,
    case_number: { trim: true, maxLength: 80 },
    num: { trim: true, maxLength: 80 },
    archive_number: { trim: true, maxLength: 80 },
    archive: { trim: true, maxLength: 80 },
    branch: { trim: true, maxLength: 120 },
    title: { trim: true, maxLength: 255 },
    subject: { trim: true, maxLength: 255 },
    description: { trim: true, maxLength: 5000 },
    desc: { trim: true, maxLength: 5000 },
    status: { enum: CASE_STATUS },
    supervision_date: { trim: true, maxLength: 32 },
    supervisionDate: { trim: true, maxLength: 32 },
    supervision_time: { trim: true, maxLength: 16 },
    supervisionTime: { trim: true, maxLength: 16 },
    supervision_note: { trim: true, maxLength: 2000 },
    supervisionNote: { trim: true, maxLength: 2000 }
  }),
  id: validate(idParam)
};

const clients = {
  create: validate(
    {
      name: { trim: true, maxLength: 160 },
      fname: { trim: true, maxLength: 80 },
      lname: { trim: true, maxLength: 80 },
      phone: { trim: true, maxLength: 32 },
      national_id: { trim: true, maxLength: 20 },
      national: { trim: true, maxLength: 20 },
      description: { trim: true, maxLength: 2000 },
      notes: { trim: true, maxLength: 2000 },
      case_id: { type: 'id' },
      caseId: { type: 'id' }
    },
    { requireAny: [['name', 'fname']] }
  ),
  update: validate({
    ...idParam,
    name: { trim: true, maxLength: 160 },
    fname: { trim: true, maxLength: 80 },
    lname: { trim: true, maxLength: 80 },
    phone: { trim: true, maxLength: 32 },
    national_id: { trim: true, maxLength: 20 },
    national: { trim: true, maxLength: 20 },
    description: { trim: true, maxLength: 2000 },
    notes: { trim: true, maxLength: 2000 },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  id: validate(idParam)
};

const tasks = {
  create: validate({
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    status: { enum: TASK_STATUS },
    priority: { enum: TASK_PRIORITY },
    due_date: { trim: true, maxLength: 32 },
    due: { trim: true, maxLength: 32 },
    note: { trim: true, maxLength: 2000 },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  update: validate({
    ...idParam,
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    status: { enum: TASK_STATUS },
    priority: { enum: TASK_PRIORITY },
    due_date: { trim: true, maxLength: 32 },
    due: { trim: true, maxLength: 32 },
    note: { trim: true, maxLength: 2000 },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  id: validate(idParam)
};

const notes = {
  create: validate({
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    content: { trim: true, maxLength: 10000 },
    body: { trim: true, maxLength: 10000 },
    text: { trim: true, maxLength: 10000 },
    category: { enum: NOTE_CAT },
    cat: { enum: NOTE_CAT },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  update: validate({
    ...idParam,
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    content: { trim: true, maxLength: 10000 },
    body: { trim: true, maxLength: 10000 },
    text: { trim: true, maxLength: 10000 },
    category: { enum: NOTE_CAT },
    cat: { enum: NOTE_CAT },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  id: validate(idParam)
};

const documents = {
  create: validate({
    file_name: { trim: true, maxLength: 255 },
    name: { trim: true, maxLength: 255 },
    category: { enum: DOC_CAT },
    cat: { enum: DOC_CAT },
    case_id: { type: 'id' },
    caseId: { type: 'id' }
  }),
  id: validate(idParam)
};

const events = {
  create: validate({
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    date: { required: true, trim: true, maxLength: 32 },
    time: { trim: true, maxLength: 16 },
    type: { enum: EVENT_TYPE },
    event_type: { enum: EVENT_TYPE },
    status: { enum: EVENT_STATUS },
    reminder: { type: 'number' },
    remind: { type: 'number' },
    note: { trim: true, maxLength: 2000 },
    description: { trim: true, maxLength: 5000 },
    location: { trim: true, maxLength: 255 },
    timezone: { trim: true, maxLength: 64 },
    case_id: { type: 'id' },
    caseId: { type: 'id' },
    client_id: { type: 'id' },
    clientId: { type: 'id' }
  }),
  update: validate({
    ...idParam,
    title: { required: true, trim: true, minLength: 1, maxLength: 255 },
    date: { required: true, trim: true, maxLength: 32 },
    time: { trim: true, maxLength: 16 },
    type: { enum: EVENT_TYPE },
    event_type: { enum: EVENT_TYPE },
    status: { enum: EVENT_STATUS },
    reminder: { type: 'number' },
    remind: { type: 'number' },
    note: { trim: true, maxLength: 2000 },
    description: { trim: true, maxLength: 5000 },
    location: { trim: true, maxLength: 255 },
    timezone: { trim: true, maxLength: 64 },
    case_id: { type: 'id' },
    caseId: { type: 'id' },
    client_id: { type: 'id' },
    clientId: { type: 'id' }
  }),
  id: validate(idParam)
};

const communications = {
  upsert: validate({
    platform: { required: true, enum: PLATFORMS },
    channel: { trim: true, maxLength: 120 },
    group: { trim: true, maxLength: 120 },
    group_name: { trim: true, maxLength: 120 }
  }),
  connect: validate({
    platform: { required: true, enum: PLATFORMS },
    channel: { trim: true, maxLength: 120 },
    group: { trim: true, maxLength: 120 },
    group_name: { trim: true, maxLength: 120 },
    token: { trim: true, maxLength: 500 }
  }),
  disconnect: validate({
    platform: { required: true, enum: PLATFORMS }
  }),
  send: validate({
    platform: { required: true, enum: PLATFORMS },
    text: { trim: true, maxLength: 4000 },
    message: { trim: true, maxLength: 4000 }
  })
};

module.exports = { cases, clients, tasks, notes, documents, events, communications };
