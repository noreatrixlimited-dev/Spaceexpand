"""Build timeline.json: every cue of the film on the song's beat grid.

Section starts and line times come from the Whisper pass (analysis/whisper_fine.txt) and the
beat tracker (analysis.json); each is written here as a bar of the grid, or as a time snapped
to the nearest beat.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
A = json.load(open(os.path.join(HERE, 'analysis.json')))
BEAT = 60 / 107.666
B0 = 10.84 - 18 * BEAT            # beat 18 = first sung "O" (Whisper + tracker agree)
beat = lambda k: round(B0 + k * BEAT, 3)
bar = lambda b, k=0: beat(18 + 4 * b + k)   # bar 0 = verse ONE
snap = lambda t, q=1: beat(round((t - B0) / BEAT * q) / q)
WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

def spell(n, b, kind, k0=0):
    """sung letter instances for one bar: slow (one per beat), fast (eighths), even (spread over the bar)."""
    L = len(WORDS[n])
    if kind == 'slow': offs = [i * (3 / (L - 1)) if L > 4 else i for i in range(L)]
    elif kind == 'fast': offs = [i * .5 for i in range(L)]
    else: offs = [i * 3.5 / L for i in range(L)]
    return [dict(t=beat(18 + 4 * b + k0 + o), i=i) for i, o in enumerate(offs)]

nums = {n: dict(n=n, sung=[], words=[], objects=[]) for n in range(1, 11)}
def S(n, *bars):
    for b, kind, *k in bars: nums[n]['sung'] += spell(n, b, kind, *(k or [0]))
def W(n, *ts): nums[n]['words'] += list(ts)
def OBJ(n, t0, count, step=1.0): nums[n]['objects'] = [beat(round((t0 - B0) / BEAT) + i * step) for i in range(count)]

# verse ONE (bars 0-11)
S(1, (0, 'slow'), (1, 'slow'), (2, 'fast'), (4, 'slow'), (5, 'slow'), (6, 'fast'))
W(1, bar(3, 1), bar(7), bar(7, 2), bar(8), bar(8, 1), bar(8, 2), bar(9), bar(9, 2)); OBJ(1, bar(3, 1), 1)
# verse TWO (bars 12-19)
S(2, (12, 'slow'), (13, 'slow'), (14, 'fast'))
W(2, bar(15), bar(15, 2), bar(16), bar(16, 1), bar(16, 2), bar(17), bar(17, 2)); OBJ(2, bar(15), 2)
# chorus 1 (bars 20-23): ONE, TWO, THREE on beats of bar 22
# verse THREE (bars 24-35)
S(3, (24, 'slow'), (25, 'slow'), (26, 'fast'), (28, 'slow'), (29, 'fast'))
W(3, bar(27), bar(30), bar(30, 2), bar(31), bar(31, 1), bar(31, 2), bar(32), bar(32, 2), bar(33), bar(33, 2)); OBJ(3, bar(27), 3)
# verse FOUR (bars 36-43)
S(4, (36, 'slow'), (37, 'slow'), (38, 'fast'))
W(4, bar(39), bar(39, 2), bar(40), bar(40, 1), bar(40, 2), bar(41), bar(41, 2)); OBJ(4, bar(39), 4)
# chorus 2 (bars 44-47)
# FIVE (bars 48-51), SIX (52-55)
S(5, (48, 'even'), (49, 'fast'), (50, 'fast'), (50, 'fast', 2))
W(5, bar(49, 2), bar(51), bar(51, 2)); OBJ(5, bar(49, 2), 5, .5)
S(6, (52, 'slow'), (53, 'fast'), (54, 'fast'), (54, 'fast', 2))
W(6, bar(53, 2), bar(55), bar(55, 2)); OBJ(6, bar(53, 2), 6, .5)
# SEVEN (56-59), EIGHT (60-63)
S(7, (56, 'even'), (57, 'even'), (58, 'even'))
W(7, bar(59), bar(59, 1), bar(59, 2)); OBJ(7, bar(59), 7, .5)
S(8, (60, 'even'), (61, 'even'), (62, 'even'))
W(8, bar(63)); OBJ(8, bar(63), 8, .5)
# break (rest of bar 63): night falls. NINE (64), TEN (65-66)
S(9, (64, 'fast'), (64, 'fast', 2))
W(9, bar(65)); OBJ(9, bar(65), 9, .25)
S(10, (65, 'fast', 1), (65, 'fast', 3), (66, 'fast'), (66, 'fast', 2))
W(10, bar(66, 3)); OBJ(10, bar(66, 3), 10, .25)

# final chorus: each number spelled fast, then the word (times from Whisper, snapped to beats)
FINAL = {1: 163.5, 2: 167.5, 3: 170.2, 4: 171.9, 5: 174.3, 6: 176.3, 7: 178.4, 8: 180.3, 9: 182.3, 10: 185.0}
pulses = []
for n, tw in FINAL.items():
    tw = snap(tw); L = len(WORDS[n])
    for i in range(L): nums[n]['sung'].append(dict(t=round(tw - BEAT - (L - 1 - i) * BEAT / 2, 3), i=i))
    nums[n]['words'].append(tw)
# chorus counts, outro counts
pulses += [dict(n=n, t=bar(22, n - 1)) for n in (1, 2, 3)]
pulses += [dict(n=n, t=bar(46, n - 1)) for n in (1, 2, 3, 4)]
OUT = {1: 192.3, 2: 192.9, 3: 193.5, 4: 194.3, 5: 194.9, 6: 195.5, 7: 196.6, 8: 197.3, 9: 198.5, 10: 199.3}
pulses += [dict(n=n, t=snap(t, 2)) for n, t in OUT.items()]

for N in nums.values():
    N['sung'].sort(key=lambda s: s['t'])
    first = {}
    for s in N['sung']: first.setdefault(s['i'], s['t'])
    N['letters'] = [first[i] for i in range(len(WORDS[N['n']]))]
    N['words'].sort()

subs = [
    (1.4, 3.3, 'Come on, friends!'), (3.4, 5.7, "Let's spell and count!"), (5.8, 7.6, 'Letters first,'), (7.7, 10.4, 'then say the number!'),
    (bar(10), bar(11), 'One bright sun'), (bar(11), bar(12) - .1, 'shining for everyone!'),
    (bar(18), bar(19), 'Two little birds'), (bar(19), bar(20) - .1, 'sing tweet tweet too!'),
    (bar(20), bar(21), 'Spell it! Say it!'), (bar(21), bar(22) - .05, 'Count with me!'), (bar(22), bar(23) - .05, 'ONE, TWO, THREE!'), (bar(23) - .05, bar(24) + .3, 'Learning numbers is so much fun!'),
    (bar(34), bar(35), 'Three red apples'), (bar(35), bar(36) - .1, 'on the tree!'),
    (bar(42), bar(43), 'Four little kittens'), (bar(43), bar(44) - .1, 'play on the floor!'),
    (bar(44), bar(45), 'Spell it! Say it!'), (bar(45), bar(46) - .05, 'Count with me!'), (bar(46), bar(47) - .05, 'ONE, TWO, THREE, FOUR!'), (bar(47) - .05, bar(48) + .2, 'Learning numbers is so much fun!'),
    (187.5, 189.6, 'Spell it! Say it!'), (189.7, 191.8, 'Count again!'),
    (191.9, 195.9, 'ONE, TWO, THREE, FOUR, FIVE, SIX!'), (196.0, 200.2, 'SEVEN, EIGHT, NINE, TEN!'),
    (200.3, 202.4, 'We can spell!'), (202.5, 204.3, 'We can count!'), (204.3, 206.6, 'Yay!'),
]
subs = [dict(t0=round(a, 3), t1=round(b, 3), text=s) for a, b, s in subs]

SPOT = {1: (760, 560, 1.05), 2: (1420, 560, 1.05), 3: (960, 1150, .95), 4: (1650, 1640, .95), 5: (2620, 1680, 1.0),
        6: (3300, 560, 1.0), 7: (2650, 1180, .78), 8: (2620, 640, .9), 9: (1920, 640, .55), 10: (3300, 1550, .9)}
FULL = (1920, 1120, .5)
cam = []
def K(t, x, y, z): cam.append(dict(t=round(t, 3), x=x, y=y, z=z))
def HOLD(t0, t1, s): K(t0, *s); K(t1, *s)
# intro: extreme close-up of the crayon tip drawing the first hill, pulling back to the empty page
K(0, 140, 1300, 2.2); K(2.6, 560, 1240, 1.5); K(6.2, 1500, 1120, .72); HOLD(8.4, bar(0) - .3, FULL)
HOLD(bar(0) + 1.0, bar(11, 2), SPOT[1])
HOLD(bar(12) + .2, bar(19, 3), SPOT[2])
HOLD(bar(20) + 1.2, bar(23, 3), (1920, 1100, .5))
HOLD(bar(24) + 1.0, bar(35, 3), SPOT[3])
HOLD(bar(36) + 1.2, bar(43, 3), SPOT[4])
HOLD(bar(44) + 1.2, bar(47, 3), (1920, 1100, .52))
HOLD(bar(48) + 1.0, bar(51, 3), SPOT[5])
HOLD(bar(52) + 1.0, bar(55, 3), SPOT[6])
HOLD(bar(56) + 1.0, bar(59, 3), SPOT[7])
HOLD(bar(60) + .8, bar(63) + .3, SPOT[8])
HOLD(bar(63) + 1.6, bar(65) + .2, (1920, 1000, .5))      # held wide while the wash moves
HOLD(bar(65) + 1.4, bar(66, 3) + 1.0, SPOT[10])
# final chorus: one travelling shot over everything that was counted
trav = {1: (760, 600, .8), 2: (1420, 600, .8), 3: (1000, 1150, .8), 4: (1650, 1600, .8), 5: (2620, 1620, .8),
        6: (3250, 620, .8), 7: (2650, 1150, .7), 8: (2620, 640, .8), 9: (1820, 560, .6), 10: (3300, 1450, .8)}
for n, tw in FINAL.items():
    K(snap(tw) - 1.6, *trav[n]); K(snap(tw) + .25, *trav[n])
HOLD(187.2, 206.9, FULL)

tl = dict(
    dur=206.8,
    intro=dict(hillT0=.3, hillT1=9.6, starsT=2.0),
    night=[bar(63) + 1.0, bar(64) + 1.4],
    numbers=[nums[n] for n in range(1, 11)],
    pulses=sorted(pulses, key=lambda p: p['t']),
    subs=subs, camera=cam, yay=snap(204.4, 2),
)
json.dump(tl, open(os.path.join(HERE, 'timeline.json'), 'w'), indent=1)
with open(os.path.join(HERE, 'cues.json'), 'w') as f: json.dump(subs, f)
print('bars:', {k: bar(v) for k, v in dict(one=0, two=12, ch1=20, three=24, four=36, ch2=44, five=48, six=52, seven=56, eight=60, brk=63, nine=64, ten=65, final=67).items()})
