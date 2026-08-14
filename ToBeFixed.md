1. Problem:
Traceback (most recent call last):
  File "/app/backend/manage.py", line 179, in <module>
    main()
  File "/app/backend/manage.py", line 175, in main
    handlers[args.command](args)
  File "/app/backend/manage.py", line 57, in cmd_list_groups
    f"currency={g['currency']}  owner={g['owner']}  "
                ~^^^^^^^^^^^^
KeyError: 'currency'
2. There should only be one way to delete a group and that should be inside the group danger zone, The one on the main page should be removed
3. When adding a user to a group by username, it should detect if a username(not email) already exist. Only if the username does not exist, it should add the member as a guest.
4. Under the dangerzone, it should be possible to remove a member. The member may only be removed if it does not partake in any transactions of the group.
5. The input fields for percentage and amount (both transactions types) are too small on some screens. Either use a min field width, or use 2 lines for transactions, or both.
