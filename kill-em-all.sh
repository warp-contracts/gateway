#!/bin/bash
for i in {3000..3000};
do
  kill $(lsof -ti:$i)
done
