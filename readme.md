I am trying to make a soccer substitution program using various LLMs. Right now I need some improvements with regard to the defense assignements.



The idea is that first total minutes per player should be equalized, then goalies assigned, then future minutes re-equalized respecting goalie constraints (as well as hard coded constraints respected at all times). At this step, each player should have an allocation of future minutes (goalie and field). Then we start deciding who plays defense each quarter. We priorize assign full quarters of defense to players who haven't played defense yet. After everyone that could play a full quarter that hasn't played has been assigned, we move on to assigning half quarters (the smallest block of time we track) to people who need defense. After everyone has some, the rest of a player minutes should be flexible. Then we move to offensive assignment and proceed in the same manner.

there is another little thing I see. At one point the idea was that minutes availability was important but not the most important thing for goalie selection. So first we find how many future minutes are needed for all players to have even playing time. Then we sort goalie (in)eligibility according to the following: 0) not eligable at all if they aren't there or are forced into another position 1) biggest penalty / lowest possibility of being goalie if they have already played more than or equal to 24 minutes (league rule, no playing more than half the game) 2) next biggest penalty if they refuse to play goalie 3) next penalty if they don't have available future minutes (for minutes fairness) 4) penalty if they have already played 12 minutes (so if possible everyone should be playing 1 quarter) 5) then prioritize by skill. 6) but of course if someone is constrained to play goalie, override all the other stuff I have noticed that if I give Jesse 90 defensive minutes (at the start, unrealistic, but just testing) it won't put him in goalie even if there is only 1 other player willing to play. So in this case it should have both Jesse and the other goalie play half the game each even though this might mean Jesse end up with a more unequal amount of minutes.

please code an included .js file that will run tests (can be triggered by clicking a button on the debug tab that will generate random test cases and then run a number of checks on those cases. Any case found to be not passing should be output as json to the console for examination.



Tests should include:



1) respecting constraints (but also make sure that the constraints themselves are not mutually exclusive)



2) assigning one and only one of every position (but be sure there are at least 2 willing goalies and 6 or more players)



3) comparing the total playing minutes between all pairs of players. Ensure that:

a) they are only separated by <= 6 minutes OR

b) there are no unconstrained future assignments where the least played of the pair is benched and the most played player was selected for a non-goalie roll (don't count constraints). 

