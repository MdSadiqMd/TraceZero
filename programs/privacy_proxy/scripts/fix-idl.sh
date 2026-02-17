#!/bin/bash
# Fix IDL address after anchor build (anchor uses wrong keypair for multi-program workspaces)
python3 -c "
import json
f=open('target/idl/privacy_proxy.json','r')
d=json.load(f)
f.close()
if d['address'] != 'Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3':
    d['address']='Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3'
    f=open('target/idl/privacy_proxy.json','w')
    json.dump(d,f,indent=2)
    f.close()
    print('Fixed privacy_proxy IDL address')
else:
    print('privacy_proxy IDL address already correct')
"

# Fix the types file - handle both old and new zk_verifier IDs
sed -i '' 's/"address": "AL6EfrDUdBdwqwrrA1gsq3KwfSJs4wLq4BKyABAzsqvA"/"address": "Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"/' target/types/privacy_proxy.ts 2>/dev/null
sed -i '' 's/"address": "2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu"/"address": "Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"/' target/types/privacy_proxy.ts 2>/dev/null
echo "Fixed types file"
