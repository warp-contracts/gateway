#!/bin/bash
for i in {3000..3015};
do
  kill $(lsof -ti:$i)
done
