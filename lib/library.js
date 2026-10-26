'use strict';
// Starting question library: the 50 statements from the Dignall & Associates
// "Core Competency 360° — Master Questionnaire (Reworded)", word for word.
// Short names and groupings were added so results are easy to read; they can
// all be renamed, regrouped, or replaced inside the app (Question Library).

const groups = {
  intellect: 'Intellect & Strategy',
  personal: 'Personal Effectiveness',
  interpersonal: 'Interpersonal Skills',
  people: 'Leading People',
  role: 'Role-Specific',
};

const rows = [
  // [group, short name, statement, tier]
  ['intellect', 'Learning Agility', 'Learns quickly and absorbs new information with ease.', 'core'],
  ['intellect', 'Analytical Depth', 'Shows strong attention to detail and can drill down to the root of an issue.', 'core'],
  ['intellect', 'Judgment', 'Uses sound judgment and rationale, reasoning objectively and drawing balanced conclusions.', 'core'],
  ['intellect', 'Decisiveness', "Is decisive, while thinking through a decision's implications thoroughly.", 'core'],
  ['intellect', 'Innovation', 'Is innovative and original, and thinks beyond conventional approaches.', 'core'],
  ['intellect', 'Practical Problem Solving', 'Generates sensible, realistic, and practical solutions to problems.', 'core'],
  ['intellect', 'Calculated Risk Taking', 'Takes calculated risks with generally favorable outcomes, showing appropriate courage.', 'core'],
  ['intellect', 'Conceptual Thinking', 'Deals effectively with abstract, intangible matters and keeps the big picture in view.', 'core'],
  ['intellect', 'Strategic Planning', 'Understands the competitive landscape and looks ahead, planning and strategizing proactively to stay ahead.', 'core'],
  ['intellect', 'Best Practices & Benchmarking', 'Benchmarks best practices and applies them to continuously improve and stay ahead.', 'core'],
  ['personal', 'Executive Presence', 'Projects a professional, charismatic presence that earns respect at every level.', 'core'],
  ['personal', 'Credibility & Stature', 'Is knowledgeable and carries themselves in a way that commands respect and admiration.', 'core'],
  ['personal', 'Integrity', "Is thoroughly ethical, holds a strong value system, and does not compromise on what's right.", 'core'],
  ['personal', 'Continuous Improvement', 'Consistently looks for a better way and is willing to try something different.', 'core'],
  ['personal', 'Organization & Time Management', 'Is well organized, prioritizes effectively, and makes the best use of time; is punctual and reliable.', 'core'],
  ['personal', 'High Standards', 'Sets high personal and group standards and does not settle for less.', 'core'],
  ['personal', 'Independence', 'Requires minimal supervision to get things done and operates effectively on their own.', 'core'],
  ['personal', 'Courage of Conviction', 'Is willing to make the big calls, expressing views with force and courage when needed.', 'core'],
  ['personal', 'Composure Under Pressure', 'Maintains poise and calm under pressure, keeping stress levels under control.', 'core'],
  ['personal', 'Self-Awareness', 'Is aware of, and willing to face, their own strengths and weaknesses, and welcomes feedback.', 'core'],
  ['personal', 'Adaptability', 'Is not rigid, and stays open to new and more progressive ideas and practices.', 'core'],
  ['interpersonal', 'Warmth & Likability', 'Is warm, sensitive, popular, and well liked.', 'core'],
  ['interpersonal', 'First Impression', 'Generates a favorable first impression, building early confidence and commanding attention.', 'core'],
  ['interpersonal', 'Listening', "Allows others to express their views, listens carefully, and is open to changing their opinion based on others' input.", 'core'],
  ['interpersonal', 'Verbal Communication', 'Articulates well, with clear and intelligent verbal delivery.', 'core'],
  ['interpersonal', 'Written Communication', 'Writes clear, precise, well-organized emails and other materials appropriate to their position.', 'core'],
  ['interpersonal', 'Assertiveness', 'Takes forceful yet appropriate stands on issues, without becoming obnoxious or abrasive.', 'core'],
  ['interpersonal', 'Team Player', 'Works collaboratively across their own team and other departments, making decisions for the good of the organization rather than personal interest.', 'core'],
  ['interpersonal', 'Customer Focus', 'Meets internal and external customer needs in ways that deliver satisfaction and excellent results.', 'core'],
  ['interpersonal', 'Organizational Savvy', 'Makes the effort to fully understand the internal organization and uses that understanding sensitively to get things done.', 'core'],
  ['interpersonal', 'Negotiation & Compromise', 'Seeks out win-win situations and arrives at satisfactory compromises.', 'core'],
  ['interpersonal', 'Persuasiveness', 'Presents alternative arguments and options in a calm, credible, and persuasive way.', 'core'],
  ['people', 'Selecting Top Talent', 'Recruits top-performing employees who continuously raise the standard of their group.', 'leader'],
  ['people', 'Addressing Poor Performance', 'Does not tolerate poor performance and takes action to address or remove underperforming employees.', 'leader'],
  ['people', 'Coaching & Development', 'Actively and successfully coaches team members through feedback, support, and appropriate training.', 'leader'],
  ['people', 'Goal Setting', 'Sets clear, ambitious, yet achievable goals for employees, providing strong direction and clear expectations.', 'leader'],
  ['people', 'Delegation & Empowerment', 'Pushes decision-making down to the lowest appropriate level, giving authority along with responsibility.', 'leader'],
  ['people', 'Performance Reviews', 'Conducts thorough, regular, and timely performance reviews, preparing well and evaluating honestly and fairly.', 'leader'],
  ['people', 'Team Building', "Fosters a healthy, harmonious, high-performing team spirit, getting the best from the team through strong leadership and by making use of each member's skills.", 'leader'],
  ['people', 'Building Diverse Teams', 'Consciously builds a diverse team, drawing on the full available talent pool.', 'leader'],
  ['people', 'Effective Meetings', 'Runs effective meetings, shown through good preparation, an organized agenda, sound time management, and real results.', 'leader'],
  ['people', 'Vision', 'Gives the group a clear vision of its function, priorities, and overall mission, and communicates that vision effectively.', 'leader'],
  ['people', 'Change Leadership', 'Introduces change in a structured, systematic way, always looking for new ways to improve.', 'leader'],
  ['people', 'Conflict Management', 'Handles conflict between employees or groups sensitively and professionally, unafraid to face it and bold enough to make the tough call.', 'leader'],
  ['people', 'Tenacity & Positive Leadership', 'Demonstrates a consistent, positive, and enthusiastic leadership style, with a reputation for not giving up easily.', 'leader'],
  ['role', 'Product & Service Knowledge', "Has a clear, comprehensive understanding of the company's products and services.", 'role'],
  ['role', 'Sales Follow-Through', 'Remains diligent throughout the entire sales process, from the sale itself to order fulfillment.', 'role'],
  ['role', 'Prospect Qualification', 'Effectively qualifies sales prospects, ensuring sales effort and time are well spent.', 'role'],
  ['role', 'Technology Use', 'Uses computer technology to its greatest effect.', 'role'],
  ['role', 'Presentation Skills', 'Addresses a group confidently and delivers well-prepared, engaging presentations.', 'role'],
];

function defaultLibrary() {
  const competencies = rows.map(([group, name, statement, tier], i) => ({
    id: 'c' + String(i + 1).padStart(3, '0'),
    category: groups[group],
    name,
    statement,
    core: tier === 'core',
  }));
  const ids = (pred) => competencies.filter(pred).map((c) => c.id);
  const templates = [
    { id: 't-full', name: 'Executive 360 — all 50 (Dignall master)', description: 'The complete master questionnaire, in its original order.', competencyIds: ids(() => true) },
    { id: 't-leader', name: 'Executive leader — core + leading people (45)', description: 'Statements 1–45. Leaves out the sales and technology items.', competencyIds: ids((c) => c.category !== groups.role) },
    { id: 't-core', name: 'Core only (32)', description: 'The statements that apply to every role, for individual contributors.', competencyIds: ids((c) => c.core) },
  ];
  return { competencies, templates };
}

const defaultInstructions =
  'Please base every answer on your own first-hand experience working with this individual. For each statement, choose the single number that best represents how consistently you see the behavior, then use the comment box to describe what you have observed — a specific example is ideal.';

const scales = {
  '1-10': {
    min: 1, max: 10,
    anchors: [
      { from: 1, to: 3, label: 'Rarely' },
      { from: 4, to: 6, label: 'Sometimes' },
      { from: 7, to: 7, label: 'More often than not' },
      { from: 8, to: 9, label: 'Very frequently' },
      { from: 10, to: 10, label: 'Always' },
    ],
  },
  '0-10': {
    min: 0, max: 10,
    anchors: [
      { from: 0, to: 0, label: 'Never' },
      { from: 1, to: 3, label: 'Rarely' },
      { from: 4, to: 6, label: 'Sometimes' },
      { from: 7, to: 7, label: 'More often than not' },
      { from: 8, to: 9, label: 'Very frequently' },
      { from: 10, to: 10, label: 'Always' },
    ],
  },
  '1-5': {
    min: 1, max: 5,
    anchors: [
      { from: 1, to: 1, label: 'Rarely' },
      { from: 2, to: 2, label: 'Sometimes' },
      { from: 3, to: 3, label: 'Often' },
      { from: 4, to: 4, label: 'Very frequently' },
      { from: 5, to: 5, label: 'Always' },
    ],
  },
};

const relationships = {
  self: 'Self',
  board: 'Board member',
  manager: 'Manager / CEO',
  peer: 'Peer',
  direct_report: 'Direct report',
  customer: 'Client / customer',
  other: 'Other',
};

module.exports = { defaultLibrary, defaultInstructions, scales, relationships };
