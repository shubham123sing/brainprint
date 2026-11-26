// BrainPrint judge tour: multi-hop questions that only the graph answers. Read-only.
// Run them all with:   cd web && npm run tour        (uses a temporary copy of graph/brainprint.rl)
// Each query is one block that starts with "// name:" and ends with ";". "// expect:" lines are checked by the tests.

// name: Q1 Citation audit: is every panel citation backed by that brain's own belief and words?
// hops: Response -BY-> Brain -STANCE-> Claim <-CITES- Response, Brain -SAID-> Utterance -SUPPORTS-> Claim
// expect: unbacked = 0 on every row
MATCH (r:Response)-[:BY]->(b:Brain), (r)-[:TO]->(i:Idea), (r)-[:CITES]->(c:Claim)
OPTIONAL MATCH (b)-[s:STANCE]->(c)
OPTIONAL MATCH (b)-[:SAID]->(u:Utterance)-[:SUPPORTS]->(c)
RETURN i.title AS question, b.name AS brain, count(c) AS cited,
       count(s) AS backed_by_own_belief, count(u) AS backed_by_own_words,
       count(CASE WHEN s IS NULL THEN 1 END) AS unbacked
ORDER BY unbacked DESC, question, brain;

// name: Q2 Which pitch sentences light up an average brain (TRIBE v2), and which personas does the same point put off?
// hops: Idea -SCANNED_AS-> Scan -HAS_MOMENT-> Moment -ACTIVATES-> Network, Moment -ABOUT-> Claim <-PREDICTS- Brain
MATCH (i:Idea)-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(m:Moment)-[act:ACTIVATES]->(n:Network)
WHERE act.z >= 0.8
MATCH (m)-[:ABOUT]->(c:Claim)<-[p:PREDICTS]-(b:Brain)
RETURN i.title AS idea, left(m.text, 70) AS sentence, n.name AS network, round(act.z * 100) / 100 AS z,
       collect(CASE WHEN p.stance = -1 THEN b.name END) AS puts_off,
       collect(CASE WHEN p.stance = 1 THEN b.name END) AS lands_with
ORDER BY z DESC LIMIT 6;

// name: Q3 Which brains share a belief, and where do they clash?
// hops: Brain -STANCE-> Claim <-STANCE- Brain (the same Claim node, because Talk reuses claims that mean the same)
MATCH (a:Brain)-[sa:STANCE]->(c:Claim)<-[sb:STANCE]-(b:Brain)
WHERE a.id < b.id
RETURN a.name AS brain_a, b.name AS brain_b, count(c) AS shared_beliefs,
       count(CASE WHEN sa.value * sb.value = -1 THEN 1 END) AS clashes,
       collect(CASE WHEN sa.value * sb.value = -1 THEN c.text END)[0..2] AS clash_examples
ORDER BY clashes DESC, shared_beliefs DESC;

// name: Q4 Which points of a pitch split the panel?
// hops: Idea -HAS_CLAIM-> Claim <-PREDICTS- Brain
MATCH (i:Idea)-[h:HAS_CLAIM]->(c:Claim)<-[p:PREDICTS]-(b:Brain)
WITH i, c, h, collect({brain: b.name, stance: p.stance}) AS votes
WHERE size([v IN votes WHERE v.stance = 1]) > 0 AND size([v IN votes WHERE v.stance = -1]) > 0
RETURN i.title AS idea, h.order AS point, left(c.text, 70) AS claim,
       [v IN votes WHERE v.stance = 1 | v.brain] AS lands_with,
       [v IN votes WHERE v.stance = -1 | v.brain] AS puts_off
ORDER BY idea, point;

// name: Q5 Shortest belief path between the CFO and the student
// hops: any number of STANCE / MENTIONS / SAME_AS / INSTANCE_OF / SUBCLASS_OF edges
// expect: length = 2
MATCH path = SHORTEST 1 (a:Brain {id: 'brain_skeptical_cfo_6ea5'})
      -[:STANCE|MENTIONS|SAME_AS|INSTANCE_OF|SUBCLASS_OF]-+
      (b:Brain {id: 'brain_budget_conscious_student_3k60'})
RETURN [n IN nodes(path) | coalesce(n.name, n.label, left(n.text, 50), n.id)] AS hops, length(path) AS length;

// name: Q6 Every belief learned by talking keeps the person's exact words
// hops: Brain -STANCE {source: talk}-> Claim, Brain -SAID-> Utterance -SUPPORTS-> Claim
// expect: quote_found = talk_beliefs on every row
MATCH (b:Brain)-[s:STANCE {source: 'talk'}]->(c:Claim)
OPTIONAL MATCH (b)-[:SAID]->(u:Utterance)-[:SUPPORTS]->(c)
WITH b, s, collect(u.text) AS texts
RETURN b.name AS brain, count(*) AS talk_beliefs,
       size([x IN collect(s.note IS NOT NULL AND any(t IN texts WHERE t CONTAINS s.note)) WHERE x]) AS quote_found;
